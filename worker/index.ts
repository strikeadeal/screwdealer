import { CreateRoomRequestSchema, JoinRoomRequestSchema, RoomCodeSchema } from "../shared/protocol";
import { createResumeToken, hashToken } from "./security";

export { RoomDurableObject } from "./room";

declare global {
  interface Env {
    ROOMS: DurableObjectNamespace<import("./room").RoomDurableObject>;
    ALLOWED_ORIGINS: string;
  }
}

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  return env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin) ? origin : null;
}

function json(body: unknown, status: number, origin?: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function parseBody(request: Request, schema: typeof CreateRoomRequestSchema) {
  try {
    return schema.safeParse(await request.json());
  } catch {
    return schema.safeParse(null);
  }
}

async function participantPayload(code: string, displayName: string) {
  const playerId = crypto.randomUUID();
  const resumeToken = createResumeToken();
  return {
    credentials: { roomCode: code, playerId, resumeToken },
    internal: { code, playerId, displayName, tokenHash: await hashToken(resumeToken), now: Date.now() },
  };
}

async function createRoom(request: Request, env: Env, origin: string): Promise<Response> {
  const parsed = await parseBody(request, CreateRoomRequestSchema);
  if (!parsed.success) return json({ code: "INVALID_REQUEST", message: "Enter a name between 1 and 20 characters." }, 400, origin);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const payload = await participantPayload(code, parsed.data.displayName);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const result = await stub.fetch("https://room.internal/internal/create", {
      method: "POST",
      body: JSON.stringify(payload.internal),
    });
    if (result.status === 409) continue;
    if (!result.ok) return json(await result.json(), result.status, origin);
    return json({ ...payload.credentials, role: "player" }, 201, origin);
  }
  return json({ code: "ROOM_CODE_EXHAUSTED", message: "Could not create a room. Try again." }, 503, origin);
}

async function joinExistingRoom(request: Request, env: Env, origin: string, code: string): Promise<Response> {
  const parsed = await parseBody(request, JoinRoomRequestSchema);
  if (!parsed.success) return json({ code: "INVALID_REQUEST", message: "Enter a name between 1 and 20 characters." }, 400, origin);
  const payload = await participantPayload(code, parsed.data.displayName);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const result = await stub.fetch("https://room.internal/internal/join", {
    method: "POST",
    body: JSON.stringify(payload.internal),
  });
  const body = (await result.json()) as { role?: "player" | "spectator" };
  if (!result.ok) return json(body, result.status, origin);
  return json({ ...payload.credentials, role: body.role }, 201, origin);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "screwdealer-api" }, 200);
    }
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed." }, 403);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") return createRoom(request, env, origin);
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const code = RoomCodeSchema.safeParse(joinMatch[1]);
      if (!code.success) return json({ code: "INVALID_ROOM_CODE", message: "Enter a six-character room code." }, 400, origin);
      return joinExistingRoom(request, env, origin, code.data);
    }
    const socketMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (request.method === "GET" && socketMatch) {
      const code = RoomCodeSchema.safeParse(socketMatch[1]);
      if (!code.success) return json({ code: "INVALID_ROOM_CODE", message: "Invalid room code." }, 400, origin);
      return env.ROOMS.get(env.ROOMS.idFromName(code.data)).fetch(request);
    }
    return json({ code: "NOT_FOUND", message: "Not found." }, 404, origin);
  },
};

export default worker;
