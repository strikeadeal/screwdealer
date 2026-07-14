import { exports } from "cloudflare:workers";
import { env, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ServerMessageSchema,
  SessionCredentialsSchema,
  type PublicRoomSnapshot,
  type ServerMessage,
  type SessionCredentials,
} from "../shared/protocol";

const ORIGIN = "http://localhost:5173";
const app = (exports as unknown as { default: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } })
  .default;

async function createRoom(displayName = "Ava"): Promise<SessionCredentials> {
  const response = await app.fetch("https://api.example/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ displayName }),
  });
  expect(response.status).toBe(201);
  return SessionCredentialsSchema.parse(await response.json());
}

async function joinRoom(roomCode: string, displayName: string): Promise<{ response: Response; body: unknown }> {
  const response = await app.fetch(`https://api.example/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ displayName }),
  });
  return { response, body: await response.json() };
}

function nextMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean = () => true): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for a server message"));
    }, 2_000);
    function onMessage(event: MessageEvent) {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success || !predicate(parsed.data)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(parsed.data);
    }
    socket.addEventListener("message", onMessage);
  });
}

async function nextSnapshot(socket: WebSocket, predicate: (snapshot: PublicRoomSnapshot) => boolean = () => true): Promise<PublicRoomSnapshot> {
  const message = await nextMessage(socket, (candidate) => candidate.type === "snapshot" && predicate(candidate.snapshot));
  if (message.type !== "snapshot") throw new Error("Expected a snapshot");
  return message.snapshot;
}

async function connect(credentials: SessionCredentials): Promise<{ socket: WebSocket; snapshot: PublicRoomSnapshot }> {
  const response = await app.fetch(
    `https://api.example/api/rooms/${credentials.roomCode}/socket?playerId=${credentials.playerId}&resumeToken=${credentials.resumeToken}`,
    { headers: { Upgrade: "websocket", Origin: ORIGIN } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket response");
  socket.accept();
  const snapshot = await nextSnapshot(socket);
  return { socket, snapshot };
}

describe("Worker room API", () => {
  it("reports health and creates resumable room credentials", async () => {
    const health = await app.fetch("https://api.example/api/health");
    expect(await health.json()).toEqual({ ok: true, service: "screwdealer-api" });

    const credentials = await createRoom();
    expect(credentials.role).toBe("player");
    expect(credentials.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("joins a room and rejects duplicate names", async () => {
    const host = await createRoom();
    const joined = await joinRoom(host.roomCode, "Ben");
    expect(joined.response.status).toBe(201);
    expect(SessionCredentialsSchema.parse(joined.body).role).toBe("player");

    const duplicate = await joinRoom(host.roomCode, " ava ");
    expect(duplicate.response.status).toBe(409);
  });

  it("rejects browser requests from unapproved origins", async () => {
    const response = await app.fetch("https://api.example/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ displayName: "Ava" }),
    });

    expect(response.status).toBe(403);
  });

  it("authenticates sockets and sends snapshots without private deck state", async () => {
    const host = await createRoom();
    await joinRoom(host.roomCode, "Ben");
    const { socket, snapshot } = await connect(host);

    expect(snapshot.code).toBe(host.roomCode);
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot).not.toHaveProperty("deck");
    expect(snapshot).not.toHaveProperty("currentCard");
    socket.close(1000, "done");
  });

  it("rejects invalid resume tokens during socket upgrade", async () => {
    const host = await createRoom();
    const response = await app.fetch(
      `https://api.example/api/rooms/${host.roomCode}/socket?playerId=${host.playerId}&resumeToken=${"x".repeat(48)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );

    expect(response.status).toBe(401);
  });

  it("broadcasts server-authoritative play and survives Durable Object eviction", async () => {
    const host = await createRoom();
    const joined = await joinRoom(host.roomCode, "Ben");
    const guest = SessionCredentialsSchema.parse(joined.body);
    const hostConnection = await connect(host);

    const rejected = nextMessage(hostConnection.socket, (message) => message.type === "command_error");
    hostConnection.socket.send(JSON.stringify({
      version: 1,
      commandId: crypto.randomUUID(),
      expectedRevision: hostConnection.snapshot.revision,
      type: "start_game",
      payload: {},
    }));
    await expect(rejected).resolves.toMatchObject({
      type: "command_error",
      code: "INVALID_ACTION",
      message: "At least two players must be connected to start.",
    });

    const guestConnection = await connect(guest);
    const workerEnv = env as unknown as Env;
    const stub = workerEnv.ROOMS.get(workerEnv.ROOMS.idFromName(host.roomCode));
    await evictDurableObject(stub);

    const startedPromise = nextSnapshot(guestConnection.socket, (snapshot) => snapshot.phase === "awaiting_deal");
    hostConnection.socket.send(JSON.stringify({
      version: 1,
      commandId: crypto.randomUUID(),
      expectedRevision: guestConnection.snapshot.revision,
      type: "start_game",
      payload: {},
    }));
    const started = await startedPromise;
    const dealerSocket = started.dealerId === host.playerId ? hostConnection.socket : guestConnection.socket;
    const observerSocket = dealerSocket === hostConnection.socket ? guestConnection.socket : hostConnection.socket;
    const dealtPromise = nextSnapshot(observerSocket, (snapshot) => snapshot.phase === "first_guess");
    dealerSocket.send(JSON.stringify({
      version: 1,
      commandId: crypto.randomUUID(),
      expectedRevision: started.revision,
      type: "deal",
      payload: {},
    }));
    const dealt = await dealtPromise;

    expect(dealt.cardsRemaining).toBe(51);
    expect(dealt).not.toHaveProperty("currentCard");
    expect(dealt).not.toHaveProperty("deck");
    hostConnection.socket.close(1000, "done");
    guestConnection.socket.close(1000, "done");
  });
});
