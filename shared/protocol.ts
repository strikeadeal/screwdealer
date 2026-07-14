import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const RankSchema = z.number().int().min(1).max(13);
export const SuitSchema = z.enum(["clubs", "diamonds", "hearts", "spades"]);
export const CardSchema = z.object({
  id: z.string().min(1),
  rank: RankSchema,
  suit: SuitSchema,
});

export const DisplayNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(20));

export const RoomCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{6}$/));

export const CreateRoomRequestSchema = z.object({ displayName: DisplayNameSchema }).strict();
export const JoinRoomRequestSchema = CreateRoomRequestSchema;

export const SessionCredentialsSchema = z
  .object({
    roomCode: RoomCodeSchema,
    playerId: z.string().uuid(),
    resumeToken: z.string().min(32).max(256),
    role: z.enum(["player", "spectator"]),
  })
  .strict();

const BaseCommandSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

const emptyPayload = z.object({}).strict();

export const ClientCommandSchema = z.discriminatedUnion("type", [
  BaseCommandSchema.extend({ type: z.literal("start_game"), payload: emptyPayload }),
  BaseCommandSchema.extend({ type: z.literal("deal"), payload: emptyPayload }),
  BaseCommandSchema.extend({ type: z.literal("guess"), payload: z.object({ rank: RankSchema }).strict() }),
  BaseCommandSchema.extend({
    type: z.literal("remove_player"),
    payload: z.object({ playerId: z.string().uuid() }).strict(),
  }),
  BaseCommandSchema.extend({ type: z.literal("claim_host"), payload: emptyPayload }),
  BaseCommandSchema.extend({ type: z.literal("rematch"), payload: emptyPayload }),
  BaseCommandSchema.extend({ type: z.literal("leave"), payload: emptyPayload }),
]);

export const PlayerStatsSchema = z.object({
  firstGuessHits: z.number().int().nonnegative(),
  secondGuessHits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
});

export const PublicPlayerSchema = z.object({
  id: z.string().uuid(),
  displayName: DisplayNameSchema,
  role: z.enum(["player", "spectator"]),
  seat: z.number().int().nonnegative().nullable(),
  drinks: z.number().int().nonnegative(),
  stats: PlayerStatsSchema,
  connected: z.boolean(),
  disconnectedAt: z.number().int().nonnegative().nullable(),
  isHost: z.boolean(),
});

export const RoundResultSchema = z.object({
  card: CardSchema,
  outcome: z.enum(["first_hit", "second_hit", "miss"]),
  drinkerId: z.string().uuid(),
  drinks: z.number().int().positive(),
});

export const PublicRoomSnapshotSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  code: RoomCodeSchema,
  revision: z.number().int().nonnegative(),
  phase: z.enum(["lobby", "awaiting_deal", "first_guess", "second_guess", "round_result", "finished"]),
  players: z.array(PublicPlayerSchema).max(8),
  hostPlayerId: z.string().uuid(),
  dealerId: z.string().uuid().nullable(),
  guesserId: z.string().uuid().nullable(),
  missStreak: z.number().int().min(0).max(2),
  firstGuess: RankSchema.nullable(),
  hint: z.enum(["higher", "lower"]).nullable(),
  allowedGuesses: z.array(RankSchema),
  roundResult: RoundResultSchema.nullable(),
  board: z.array(CardSchema).max(52),
  cardsRemaining: z.number().int().min(0).max(52),
  paused: z.boolean(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: PublicRoomSnapshotSchema }),
  z.object({
    type: z.literal("command_error"),
    commandId: z.string().uuid().nullable(),
    code: z.string().min(1),
    message: z.string().min(1),
    snapshot: PublicRoomSnapshotSchema.optional(),
  }),
]);

export type Rank = z.infer<typeof RankSchema>;
export type Suit = z.infer<typeof SuitSchema>;
export type Card = z.infer<typeof CardSchema>;
export type ClientCommand = z.infer<typeof ClientCommandSchema>;
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;
export type PublicRoomSnapshot = z.infer<typeof PublicRoomSnapshotSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type SessionCredentials = z.infer<typeof SessionCredentialsSchema>;
