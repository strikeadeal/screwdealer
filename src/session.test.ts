import { beforeEach, describe, expect, it } from "vitest";
import type { SessionCredentials } from "../shared/protocol";
import { clearSession, loadSession, saveSession, socketUrl } from "./session";

const credentials: SessionCredentials = {
  roomCode: "NIGHT7",
  playerId: "11111111-1111-4111-8111-111111111111",
  resumeToken: "a".repeat(32),
  role: "player",
};

describe("room session persistence", () => {
  beforeEach(() => localStorage.clear());

  it("stores and restores a room-scoped session", () => {
    saveSession(credentials);

    expect(loadSession("night7")).toEqual(credentials);
  });

  it("clears both the room and last-room pointers", () => {
    saveSession(credentials);
    clearSession(credentials.roomCode);

    expect(loadSession(credentials.roomCode)).toBeNull();
    expect(localStorage.getItem("screwdealer.last-room.v1")).toBeNull();
  });

  it("builds secure socket URLs from an HTTPS API", () => {
    expect(socketUrl("https://api.example", credentials)).toBe(
      `wss://api.example/api/rooms/NIGHT7/socket?playerId=${credentials.playerId}&resumeToken=${credentials.resumeToken}`,
    );
  });
});
