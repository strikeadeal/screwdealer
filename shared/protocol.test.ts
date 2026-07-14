import { describe, expect, it } from "vitest";
import {
  ClientCommandSchema,
  CreateRoomRequestSchema,
  RoomCodeSchema,
  SessionCredentialsSchema,
} from "./protocol";

describe("wire protocol", () => {
  it("normalizes valid display names and rejects empty names", () => {
    expect(CreateRoomRequestSchema.parse({ displayName: "  Ava  " })).toEqual({ displayName: "Ava" });
    expect(() => CreateRoomRequestSchema.parse({ displayName: "   " })).toThrow();
  });

  it("accepts unambiguous six-character room codes", () => {
    expect(RoomCodeSchema.parse("night7")).toBe("NIGHT7");
    expect(() => RoomCodeSchema.parse("O0IL12")).toThrow();
  });

  it("validates versioned commands and Ace-low ranks", () => {
    expect(
      ClientCommandSchema.parse({
        version: 1,
        commandId: "0f0d85e3-fd6d-47c3-a6ad-5fd084b4fa09",
        expectedRevision: 2,
        type: "guess",
        payload: { rank: 1 },
      }).type,
    ).toBe("guess");
    expect(() =>
      ClientCommandSchema.parse({
        version: 1,
        commandId: "0f0d85e3-fd6d-47c3-a6ad-5fd084b4fa09",
        expectedRevision: 2,
        type: "guess",
        payload: { rank: 14 },
      }),
    ).toThrow();
  });

  it("requires opaque session credentials", () => {
    expect(() =>
      SessionCredentialsSchema.parse({
        roomCode: "NIGHT7",
        playerId: "p1",
        resumeToken: "short",
        role: "player",
      }),
    ).toThrow();
  });
});
