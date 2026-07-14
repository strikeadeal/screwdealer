import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createDeck,
  createRoomState,
  GameError,
  joinRoom,
  toPublicSnapshot,
  type Card,
  type ClientCommand,
  type PrivateRoomState,
} from "./game";
import * as game from "./game";

let commandSequence = 0;

function card(rank: Card["rank"], suit: Card["suit"] = "hearts"): Card {
  return { id: `${suit}-${rank}-${commandSequence++}`, rank, suit };
}

function makeRoom(names = ["Ava", "Ben", "Chloe"], deck = [card(10), card(2)]): PrivateRoomState {
  let state = createRoomState({
    code: "NIGHT7",
    host: { id: "p1", displayName: names[0], tokenHash: "hash-1" },
    now: 1_000,
    deck,
  });

  for (let index = 1; index < names.length; index += 1) {
    state = joinRoom(
      state,
      { id: `p${index + 1}`, displayName: names[index], tokenHash: `hash-${index + 1}` },
      1_000 + index,
    );
  }

  return state;
}

function issue<T extends ClientCommand["type"]>(
  state: PrivateRoomState,
  actorId: string,
  type: T,
  payload: Extract<ClientCommand, { type: T }>["payload"],
  commandId = `command-${commandSequence++}`,
): PrivateRoomState {
  return applyCommand(
    state,
    actorId,
    { version: 1, commandId, expectedRevision: state.revision, type, payload } as ClientCommand,
    state.lastActivityAt + 1,
    () => 0,
  );
}

function startAndDeal(state: PrivateRoomState): PrivateRoomState {
  const started = issue(state, "p1", "start_game", {});
  return issue(started, started.dealerId!, "deal", {});
}

describe("game domain", () => {
  it("creates one card for every rank and suit", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}-${card.suit}`))).toHaveLength(52);
    expect(deck.map((card) => card.rank)).toEqual(expect.arrayContaining([1, 13]));
  });

  it("exposes an authoritative room state machine", () => {
    const exports = game as unknown as Record<string, unknown>;

    expect(exports.createRoomState).toBeTypeOf("function");
    expect(exports.joinRoom).toBeTypeOf("function");
    expect(exports.applyCommand).toBeTypeOf("function");
    expect(exports.toPublicSnapshot).toBeTypeOf("function");
  });

  it("starts with a random dealer and the player to their left guessing", () => {
    const state = issue(makeRoom(), "p1", "start_game", {});

    expect(state.phase).toBe("awaiting_deal");
    expect(state.dealerId).toBe("p1");
    expect(state.guesserId).toBe("p2");
  });

  it("lets only the dealer draw one hidden card", () => {
    const lobby = issue(makeRoom(), "p1", "start_game", {});
    const state = issue(lobby, "p1", "deal", {});

    expect(state.phase).toBe("first_guess");
    expect(state.currentCard?.rank).toBe(10);
    expect(state.deck).toHaveLength(1);
    expect(() => issue(lobby, "p2", "deal", {})).toThrowError(GameError);
  });

  it("assigns four drinks to the dealer for a first-guess hit", () => {
    const dealt = startAndDeal(makeRoom());
    const state = issue(dealt, "p2", "guess", { rank: 10 });

    expect(state.phase).toBe("round_result");
    expect(state.players.find((player) => player.id === "p1")?.drinks).toBe(4);
    expect(state.missStreak).toBe(0);
    expect(state.board.at(-1)?.rank).toBe(10);
    expect(state.guesserId).toBe("p3");
  });

  it("publishes higher and constrains the second guess after a low first guess", () => {
    const dealt = startAndDeal(makeRoom());
    const state = issue(dealt, "p2", "guess", { rank: 7 });

    expect(state.phase).toBe("second_guess");
    expect(state.hint).toBe("higher");
    expect(state.allowedGuesses).toEqual([8, 9, 10, 11, 12, 13]);
    expect(() => issue(state, "p2", "guess", { rank: 6 })).toThrowError(GameError);
  });

  it("assigns two drinks to the dealer for a second-guess hit", () => {
    const firstMiss = issue(startAndDeal(makeRoom()), "p2", "guess", { rank: 7 });
    const state = issue(firstMiss, "p2", "guess", { rank: 10 });

    expect(state.players.find((player) => player.id === "p1")?.drinks).toBe(2);
    expect(state.players.find((player) => player.id === "p1")?.stats.secondGuessHits).toBe(1);
    expect(state.missStreak).toBe(0);
  });

  it("assigns one drink to the guesser and increments the streak after two misses", () => {
    const firstMiss = issue(startAndDeal(makeRoom()), "p2", "guess", { rank: 7 });
    const state = issue(firstMiss, "p2", "guess", { rank: 9 });

    expect(state.players.find((player) => player.id === "p2")?.drinks).toBe(1);
    expect(state.players.find((player) => player.id === "p2")?.stats.misses).toBe(1);
    expect(state.missStreak).toBe(1);
  });

  it("resets an existing miss streak after a correct guess", () => {
    const room = makeRoom();
    room.missStreak = 2;
    const state = issue(startAndDeal(room), "p2", "guess", { rank: 10 });

    expect(state.missStreak).toBe(0);
  });

  it("rotates left after the third miss and skips the existing dealer", () => {
    const room = makeRoom(["Ava", "Ben", "Chloe", "Dylan"]);
    const started = issue(room, "p1", "start_game", {});
    started.guesserId = "p4";
    started.missStreak = 2;
    const dealt = issue(started, "p1", "deal", {});
    const firstMiss = issue(dealt, "p4", "guess", { rank: 7 });
    const state = issue(firstMiss, "p4", "guess", { rank: 9 });

    expect(state.dealerId).toBe("p2");
    expect(state.guesserId).toBe("p3");
    expect(state.missStreak).toBe(0);
  });

  it("swaps dealer and guesser after the third miss in a two-player room", () => {
    const room = makeRoom(["Ava", "Ben"]);
    const started = issue(room, "p1", "start_game", {});
    started.missStreak = 2;
    const dealt = issue(started, "p1", "deal", {});
    const firstMiss = issue(dealt, "p2", "guess", { rank: 7 });
    const state = issue(firstMiss, "p2", "guess", { rank: 9 });

    expect(state.dealerId).toBe("p2");
    expect(state.guesserId).toBe("p1");
  });

  it("finishes after the final card is resolved", () => {
    const room = makeRoom(undefined, [card(10)]);
    const state = issue(startAndDeal(room), "p2", "guess", { rank: 10 });

    expect(state.phase).toBe("finished");
    expect(state.cardsRemaining).toBe(0);
  });

  it("adds late joiners as spectators and seats them on rematch", () => {
    const started = issue(makeRoom(["Ava", "Ben"]), "p1", "start_game", {});
    let state = joinRoom(started, { id: "p3", displayName: "Chloe", tokenHash: "hash-3" }, 2_000);

    expect(state.players.find((player) => player.id === "p3")?.role).toBe("spectator");
    state.phase = "finished";
    state = issue(state, "p1", "rematch", {});
    expect(state.players.find((player) => player.id === "p3")?.role).toBe("player");
  });

  it("returns to the lobby when fewer than two seated players remain", () => {
    const state = issue(makeRoom(["Ava", "Ben"]), "p2", "leave", {});

    expect(state.phase).toBe("lobby");
    expect(state.players).toHaveLength(1);
  });

  it("promotes waiting spectators and resets an interrupted game in the lobby", () => {
    let state = issue(makeRoom(["Ava", "Ben"]), "p1", "start_game", {});
    state = joinRoom(state, { id: "p3", displayName: "Chloe", tokenHash: "hash-3" }, 2_000);
    state = issue(state, state.dealerId!, "deal", {});
    state = issue(state, state.guesserId!, "guess", { rank: 10 });
    state = issue(state, "p2", "leave", {});

    expect(state.phase).toBe("lobby");
    expect(state.players.map((player) => player.role)).toEqual(["player", "player"]);
    expect(state.board).toHaveLength(0);
    expect(state.deck).toHaveLength(52);
    expect(state.players.every((player) => player.drinks === 0)).toBe(true);
  });

  it("redacts the hidden card and deck from public snapshots", () => {
    const state = startAndDeal(makeRoom());
    const snapshot = toPublicSnapshot(state, new Set(["p1", "p2", "p3"]));

    expect(snapshot.cardsRemaining).toBe(1);
    expect(snapshot).not.toHaveProperty("currentCard");
    expect(snapshot).not.toHaveProperty("deck");
  });

  it("deduplicates command ids and rejects stale revisions", () => {
    const room = makeRoom();
    const commandId = "same-command";
    const started = issue(room, "p1", "start_game", {}, commandId);
    const repeated = applyCommand(
      started,
      "p1",
      { version: 1, commandId, expectedRevision: room.revision, type: "start_game", payload: {} },
      5_000,
      () => 0,
    );

    expect(repeated).toEqual(started);
    expect(() =>
      applyCommand(
        started,
        "p1",
        { version: 1, commandId: "stale", expectedRevision: 0, type: "deal", payload: {} },
        5_001,
        () => 0,
      ),
    ).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
  });

  it("rejects duplicate case-insensitive names", () => {
    const room = makeRoom(["Ava", "Ben"]);

    expect(() =>
      joinRoom(room, { id: "p3", displayName: "  ava  ", tokenHash: "hash-3" }, 2_000),
    ).toThrowError(expect.objectContaining({ code: "NAME_TAKEN" }));
  });
});
