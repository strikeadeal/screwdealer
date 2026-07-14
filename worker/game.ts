export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
}

export type RoomPhase =
  | "lobby"
  | "awaiting_deal"
  | "first_guess"
  | "second_guess"
  | "round_result"
  | "finished";

export interface PlayerStats {
  firstGuessHits: number;
  secondGuessHits: number;
  misses: number;
}

export interface PlayerState {
  id: string;
  displayName: string;
  tokenHash: string;
  role: "player" | "spectator";
  seat: number | null;
  drinks: number;
  stats: PlayerStats;
  disconnectedAt: number | null;
}

export interface ParticipantSeed {
  id: string;
  displayName: string;
  tokenHash: string;
}

export interface RoundResult {
  card: Card;
  outcome: "first_hit" | "second_hit" | "miss";
  drinkerId: string;
  drinks: number;
}

export interface PrivateRoomState {
  schemaVersion: 1;
  code: string;
  revision: number;
  phase: RoomPhase;
  hostPlayerId: string;
  players: PlayerState[];
  deck: Card[];
  board: Card[];
  currentCard: Card | null;
  dealerId: string | null;
  guesserId: string | null;
  missStreak: number;
  firstGuess: Rank | null;
  hint: "higher" | "lower" | null;
  allowedGuesses: Rank[];
  roundResult: RoundResult | null;
  cardsRemaining: number;
  recentCommandIds: Record<string, string[]>;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

type BaseCommand<T extends string, P> = {
  version: 1;
  commandId: string;
  expectedRevision: number;
  type: T;
  payload: P;
};

export type ClientCommand =
  | BaseCommand<"start_game", Record<string, never>>
  | BaseCommand<"deal", Record<string, never>>
  | BaseCommand<"guess", { rank: Rank }>
  | BaseCommand<"remove_player", { playerId: string }>
  | BaseCommand<"claim_host", Record<string, never>>
  | BaseCommand<"rematch", Record<string, never>>
  | BaseCommand<"leave", Record<string, never>>;

export type GameErrorCode =
  | "INVALID_ACTION"
  | "INVALID_NAME"
  | "NAME_TAKEN"
  | "ROOM_FULL"
  | "NOT_FOUND"
  | "NOT_HOST"
  | "NOT_YOUR_TURN"
  | "STALE_REVISION";

export class GameError extends Error {
  constructor(
    public readonly code: GameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameError";
  }
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;

function secureRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 2 ** 32;
}

export function createDeck(random: () => number = secureRandom): Card[] {
  const deck = SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}`, rank, suit })),
  );

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function emptyStats(): PlayerStats {
  return { firstGuessHits: 0, secondGuessHits: 0, misses: 0 };
}

function playerFromSeed(seed: ParticipantSeed, role: PlayerState["role"], seat: number | null): PlayerState {
  return {
    ...seed,
    displayName: seed.displayName.trim(),
    role,
    seat,
    drinks: 0,
    stats: emptyStats(),
    disconnectedAt: null,
  };
}

function validateName(displayName: string): string {
  const normalized = displayName.trim();
  if (normalized.length < 1 || [...normalized].length > 20) {
    throw new GameError("INVALID_NAME", "Names must be between 1 and 20 characters.");
  }
  return normalized;
}

function activePlayers(state: PrivateRoomState): PlayerState[] {
  return state.players
    .filter((player) => player.role === "player")
    .toSorted((left, right) => (left.seat ?? 0) - (right.seat ?? 0));
}

function nextPlayer(state: PrivateRoomState, fromId: string, excluded = new Set<string>()): PlayerState {
  const seated = activePlayers(state);
  const startIndex = seated.findIndex((player) => player.id === fromId);
  if (startIndex < 0) throw new GameError("NOT_FOUND", "Player is not seated.");

  for (let offset = 1; offset <= seated.length; offset += 1) {
    const candidate = seated[(startIndex + offset) % seated.length];
    if (!excluded.has(candidate.id)) return candidate;
  }
  throw new GameError("INVALID_ACTION", "No eligible player is available.");
}

function markActivity(state: PrivateRoomState, now: number): void {
  state.revision += 1;
  state.lastActivityAt = now;
  state.expiresAt = now + ROOM_TTL_MS;
}

export function createRoomState(input: {
  code: string;
  host: ParticipantSeed;
  now: number;
  deck?: Card[];
}): PrivateRoomState {
  validateName(input.host.displayName);
  const deck = input.deck ? structuredClone(input.deck) : createDeck();
  return {
    schemaVersion: 1,
    code: input.code,
    revision: 0,
    phase: "lobby",
    hostPlayerId: input.host.id,
    players: [playerFromSeed(input.host, "player", 0)],
    deck,
    board: [],
    currentCard: null,
    dealerId: null,
    guesserId: null,
    missStreak: 0,
    firstGuess: null,
    hint: null,
    allowedGuesses: [],
    roundResult: null,
    cardsRemaining: deck.length,
    recentCommandIds: {},
    createdAt: input.now,
    lastActivityAt: input.now,
    expiresAt: input.now + ROOM_TTL_MS,
  };
}

export function joinRoom(state: PrivateRoomState, seed: ParticipantSeed, now: number): PrivateRoomState {
  const next = structuredClone(state);
  const name = validateName(seed.displayName);
  if (next.players.length >= 8) throw new GameError("ROOM_FULL", "This room already has eight people.");
  if (next.players.some((player) => player.displayName.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new GameError("NAME_TAKEN", "That name is already in this room.");
  }

  const role = next.phase === "lobby" ? "player" : "spectator";
  const seat = role === "player" ? activePlayers(next).length : null;
  next.players.push(playerFromSeed({ ...seed, displayName: name }, role, seat));
  markActivity(next, now);
  return next;
}

function assertHost(state: PrivateRoomState, actorId: string): void {
  if (state.hostPlayerId !== actorId) throw new GameError("NOT_HOST", "Only the host can do that.");
}

function resetRound(state: PrivateRoomState): void {
  state.currentCard = null;
  state.firstGuess = null;
  state.hint = null;
  state.allowedGuesses = [];
  state.roundResult = null;
}

function beginGame(state: PrivateRoomState, random: () => number): void {
  const seated = activePlayers(state);
  if (seated.length < 2) throw new GameError("INVALID_ACTION", "At least two players are required.");
  const dealerIndex = Math.min(seated.length - 1, Math.floor(random() * seated.length));
  state.dealerId = seated[dealerIndex].id;
  state.guesserId = seated[(dealerIndex + 1) % seated.length].id;
  state.phase = "awaiting_deal";
  state.missStreak = 0;
  resetRound(state);
}

function removePlayer(state: PrivateRoomState, playerId: string, random: () => number): void {
  const original = activePlayers(state);
  const removedIndex = original.findIndex((player) => player.id === playerId);
  state.players = state.players.filter((player) => player.id !== playerId);

  if (state.hostPlayerId === playerId) {
    state.hostPlayerId = activePlayers(state)[0]?.id ?? state.players[0]?.id ?? "";
  }

  const seated = activePlayers(state);
  if (seated.length < 2) {
    state.players.forEach((player, index) => {
      player.role = "player";
      player.seat = index;
      player.drinks = 0;
      player.stats = emptyStats();
    });
    state.deck = createDeck(random);
    state.board = [];
    state.cardsRemaining = state.deck.length;
    state.phase = "lobby";
    state.dealerId = null;
    state.guesserId = null;
    state.missStreak = 0;
    resetRound(state);
    return;
  }

  if (state.dealerId === playerId) {
    const replacement = seated[Math.max(0, removedIndex) % seated.length];
    state.dealerId = replacement.id;
    state.guesserId = nextPlayer(state, replacement.id, new Set([replacement.id])).id;
    state.phase = "awaiting_deal";
    state.missStreak = 0;
    resetRound(state);
  } else if (state.guesserId === playerId) {
    const previous = original[(removedIndex - 1 + original.length) % original.length];
    state.guesserId = nextPlayer(state, previous.id, new Set([state.dealerId ?? ""])).id;
    state.phase = "awaiting_deal";
    resetRound(state);
  }
}

function finishRound(state: PrivateRoomState, outcome: RoundResult["outcome"]): void {
  const card = state.currentCard;
  const dealerId = state.dealerId;
  const guesserId = state.guesserId;
  if (!card || !dealerId || !guesserId) throw new GameError("INVALID_ACTION", "No round is active.");

  let drinkerId: string;
  let drinks: number;
  if (outcome === "first_hit") {
    drinkerId = dealerId;
    drinks = 4;
    state.players.find((player) => player.id === dealerId)!.stats.firstGuessHits += 1;
    state.missStreak = 0;
  } else if (outcome === "second_hit") {
    drinkerId = dealerId;
    drinks = 2;
    state.players.find((player) => player.id === dealerId)!.stats.secondGuessHits += 1;
    state.missStreak = 0;
  } else {
    drinkerId = guesserId;
    drinks = 1;
    state.players.find((player) => player.id === guesserId)!.stats.misses += 1;
    state.missStreak += 1;
  }
  state.players.find((player) => player.id === drinkerId)!.drinks += drinks;
  state.board.push(card);
  state.roundResult = { card, outcome, drinkerId, drinks };
  state.currentCard = null;

  if (outcome === "miss" && state.missStreak >= 3) {
    const seated = activePlayers(state);
    const oldDealerId = dealerId;
    const newDealer =
      seated.length === 2
        ? state.players.find((player) => player.id === guesserId)!
        : nextPlayer(state, guesserId, new Set([oldDealerId]));
    state.dealerId = newDealer.id;
    state.guesserId = nextPlayer(state, newDealer.id, new Set([newDealer.id])).id;
    state.missStreak = 0;
  } else {
    state.guesserId = nextPlayer(state, guesserId, new Set([state.dealerId ?? ""])).id;
  }

  state.phase = state.deck.length === 0 ? "finished" : "round_result";
  state.cardsRemaining = state.deck.length;
  state.firstGuess = null;
  state.hint = null;
  state.allowedGuesses = [];
}

function handleGuess(state: PrivateRoomState, actorId: string, rank: Rank): void {
  if (actorId !== state.guesserId) throw new GameError("NOT_YOUR_TURN", "Only the current guesser can guess.");
  if (!RANKS.includes(rank)) throw new GameError("INVALID_ACTION", "Choose a valid card value.");
  const card = state.currentCard;
  if (!card) throw new GameError("INVALID_ACTION", "The dealer has not dealt a card.");

  if (state.phase === "first_guess") {
    if (rank === card.rank) {
      finishRound(state, "first_hit");
      return;
    }
    state.firstGuess = rank;
    state.hint = rank < card.rank ? "higher" : "lower";
    state.allowedGuesses = RANKS.filter((candidate) =>
      state.hint === "higher" ? candidate > rank : candidate < rank,
    );
    state.phase = "second_guess";
    return;
  }

  if (state.phase !== "second_guess" || !state.allowedGuesses.includes(rank)) {
    throw new GameError("INVALID_ACTION", "That value is outside the higher/lower range.");
  }
  finishRound(state, rank === card.rank ? "second_hit" : "miss");
}

export function applyCommand(
  state: PrivateRoomState,
  actorId: string,
  command: ClientCommand,
  now: number,
  random: () => number = secureRandom,
): PrivateRoomState {
  if (state.recentCommandIds[actorId]?.includes(command.commandId)) return state;
  if (command.version !== 1 || command.expectedRevision !== state.revision) {
    throw new GameError("STALE_REVISION", "The room changed; refresh before trying again.");
  }
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) throw new GameError("NOT_FOUND", "Player is not in this room.");

  const next = structuredClone(state);
  switch (command.type) {
    case "start_game":
      assertHost(next, actorId);
      if (next.phase !== "lobby") throw new GameError("INVALID_ACTION", "The game has already started.");
      beginGame(next, random);
      break;
    case "deal":
      if (actorId !== next.dealerId) throw new GameError("NOT_YOUR_TURN", "Only the dealer can deal.");
      if (next.phase !== "awaiting_deal" && next.phase !== "round_result") {
        throw new GameError("INVALID_ACTION", "Finish the current round first.");
      }
      next.currentCard = next.deck.shift() ?? null;
      if (!next.currentCard) throw new GameError("INVALID_ACTION", "The deck is empty.");
      next.cardsRemaining = next.deck.length;
      next.phase = "first_guess";
      next.firstGuess = null;
      next.hint = null;
      next.allowedGuesses = [];
      next.roundResult = null;
      break;
    case "guess":
      handleGuess(next, actorId, command.payload.rank);
      break;
    case "leave":
      removePlayer(next, actorId, random);
      break;
    case "remove_player": {
      assertHost(next, actorId);
      const target = next.players.find((player) => player.id === command.payload.playerId);
      if (!target) throw new GameError("NOT_FOUND", "Player is not in this room.");
      if (target.disconnectedAt === null || now - target.disconnectedAt < 60_000) {
        throw new GameError("INVALID_ACTION", "That player is still connected or inside the grace period.");
      }
      removePlayer(next, target.id, random);
      break;
    }
    case "claim_host": {
      const host = next.players.find((player) => player.id === next.hostPlayerId);
      if (!host || host.disconnectedAt === null || now - host.disconnectedAt < 60_000) {
        throw new GameError("INVALID_ACTION", "The host can still reconnect.");
      }
      const eligible = activePlayers(next).find((player) => player.disconnectedAt === null);
      if (eligible?.id !== actorId) throw new GameError("INVALID_ACTION", "Another player is next to host.");
      next.hostPlayerId = actorId;
      break;
    }
    case "rematch":
      assertHost(next, actorId);
      if (next.phase !== "finished") throw new GameError("INVALID_ACTION", "Finish the deck before rematching.");
      next.players.forEach((player, index) => {
        player.role = "player";
        player.seat = index;
        player.drinks = 0;
        player.stats = emptyStats();
      });
      next.deck = createDeck(random);
      next.board = [];
      next.cardsRemaining = next.deck.length;
      beginGame(next, random);
      break;
  }

  markActivity(next, now);
  const recent = next.recentCommandIds[actorId] ?? [];
  next.recentCommandIds[actorId] = [...recent, command.commandId].slice(-20);
  return next;
}

export interface PublicPlayer {
  id: string;
  displayName: string;
  role: PlayerState["role"];
  seat: number | null;
  drinks: number;
  stats: PlayerStats;
  connected: boolean;
  disconnectedAt: number | null;
  isHost: boolean;
}

export interface PublicRoomSnapshot {
  version: 1;
  code: string;
  revision: number;
  phase: RoomPhase;
  players: PublicPlayer[];
  hostPlayerId: string;
  dealerId: string | null;
  guesserId: string | null;
  missStreak: number;
  firstGuess: Rank | null;
  hint: "higher" | "lower" | null;
  allowedGuesses: Rank[];
  roundResult: RoundResult | null;
  board: Card[];
  cardsRemaining: number;
  paused: boolean;
}

export function toPublicSnapshot(
  state: PrivateRoomState,
  connectedPlayerIds: Set<string>,
): PublicRoomSnapshot {
  const activePhase = ["awaiting_deal", "first_guess", "second_guess", "round_result"].includes(state.phase);
  const paused =
    activePhase &&
    ((!state.dealerId || !connectedPlayerIds.has(state.dealerId)) ||
      (!state.guesserId || !connectedPlayerIds.has(state.guesserId)));

  return {
    version: 1,
    code: state.code,
    revision: state.revision,
    phase: state.phase,
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      role: player.role,
      seat: player.seat,
      drinks: player.drinks,
      stats: player.stats,
      connected: connectedPlayerIds.has(player.id),
      disconnectedAt: player.disconnectedAt,
      isHost: player.id === state.hostPlayerId,
    })),
    hostPlayerId: state.hostPlayerId,
    dealerId: state.dealerId,
    guesserId: state.guesserId,
    missStreak: state.missStreak,
    firstGuess: state.firstGuess,
    hint: state.hint,
    allowedGuesses: state.allowedGuesses,
    roundResult: state.roundResult,
    board: state.board,
    cardsRemaining: state.cardsRemaining,
    paused,
  };
}
