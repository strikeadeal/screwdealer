import { DurableObject } from "cloudflare:workers";
import { ClientCommandSchema } from "../shared/protocol";
import {
  applyCommand,
  createRoomState,
  GameError,
  joinRoom,
  toPublicSnapshot,
  type ClientCommand as GameClientCommand,
  type PrivateRoomState,
} from "./game";
import { hashToken, safeHashEqual } from "./security";

interface ConnectionAttachment {
  playerId: string;
}

interface InternalParticipantRequest {
  code: string;
  playerId: string;
  displayName: string;
  tokenHash: string;
  now: number;
}

export class RoomDurableObject extends DurableObject<Env> {
  private room: PrivateRoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<PrivateRoomState>("room")) ?? null;
    });
  }

  private connectedIds(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .filter((socket) => socket.readyState < 2)
        .map((socket) => (socket.deserializeAttachment() as ConnectionAttachment | null)?.playerId)
        .filter((id): id is string => Boolean(id)),
    );
  }

  private snapshot() {
    if (!this.room) throw new GameError("NOT_FOUND", "Room not found.");
    return toPublicSnapshot(this.room, this.connectedIds());
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(this.room.expiresAt);
  }

  private broadcast(): void {
    if (!this.room) return;
    const message = JSON.stringify({ type: "snapshot", snapshot: this.snapshot() });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === 1) socket.send(message);
    }
  }

  private sendError(socket: WebSocket, commandId: string | null, code: string, message: string): void {
    socket.send(JSON.stringify({ type: "command_error", commandId, code, message, snapshot: this.room ? this.snapshot() : undefined }));
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (this.room) return Response.json({ code: "ROOM_EXISTS", message: "Room code collision." }, { status: 409 });
    const body = (await request.json()) as InternalParticipantRequest;
    this.room = createRoomState({
      code: body.code,
      host: { id: body.playerId, displayName: body.displayName, tokenHash: body.tokenHash },
      now: body.now,
    });
    await this.persist();
    return Response.json({ role: "player" }, { status: 201 });
  }

  private async handleJoin(request: Request): Promise<Response> {
    if (!this.room) return Response.json({ code: "ROOM_NOT_FOUND", message: "Room not found." }, { status: 404 });
    const body = (await request.json()) as InternalParticipantRequest;
    try {
      this.room = joinRoom(
        this.room,
        { id: body.playerId, displayName: body.displayName, tokenHash: body.tokenHash },
        body.now,
      );
      const role = this.room.players.find((player) => player.id === body.playerId)!.role;
      await this.persist();
      this.broadcast();
      return Response.json({ role }, { status: 201 });
    } catch (error) {
      if (error instanceof GameError) {
        const status = error.code === "ROOM_FULL" || error.code === "NAME_TAKEN" ? 409 : 400;
        return Response.json({ code: error.code, message: error.message }, { status });
      }
      throw error;
    }
  }

  private async handleSocket(request: Request): Promise<Response> {
    if (!this.room) return new Response("Room not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");
    const token = url.searchParams.get("resumeToken");
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    if (!player || !token || !safeHashEqual(player.tokenHash, await hashToken(token))) {
      return new Response("Invalid session", { status: 401 });
    }

    for (const existing of this.ctx.getWebSockets(`player:${player.id}`)) {
      existing.close(4001, "Reconnected elsewhere");
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`player:${player.id}`]);
    server.serializeAttachment({ playerId: player.id } satisfies ConnectionAttachment);

    if (player.disconnectedAt !== null) {
      player.disconnectedAt = null;
      this.room.revision += 1;
      this.room.lastActivityAt = Date.now();
      this.room.expiresAt = Date.now() + 24 * 60 * 60 * 1_000;
      await this.persist();
    }
    queueMicrotask(() => this.broadcast());
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/internal/create" && request.method === "POST") return this.handleCreate(request);
    if (path === "/internal/join" && request.method === "POST") return this.handleJoin(request);
    if (path.endsWith("/socket")) return this.handleSocket(request);
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.room || typeof message !== "string" || message.length > 2_048) {
      socket.close(1003, "Invalid message");
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.sendError(socket, null, "INVALID_MESSAGE", "Message must be valid JSON.");
      return;
    }
    const parsed = ClientCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendError(socket, null, "INVALID_MESSAGE", "Command did not match protocol version 1.");
      return;
    }
    const attachment = socket.deserializeAttachment() as ConnectionAttachment;
    try {
      const snapshot = this.snapshot();
      if (snapshot.paused && (parsed.data.type === "deal" || parsed.data.type === "guess")) {
        throw new GameError("INVALID_ACTION", "Waiting for the active player to reconnect.");
      }
      if (
        parsed.data.type === "start_game" &&
        snapshot.players.filter((player) => player.role === "player" && player.connected).length < 2
      ) {
        throw new GameError("INVALID_ACTION", "At least two players must be connected to start.");
      }
      this.room = applyCommand(this.room, attachment.playerId, parsed.data as GameClientCommand, Date.now());
      await this.persist();
      this.broadcast();
      if (parsed.data.type === "leave") socket.close(1000, "Left room");
    } catch (error) {
      if (error instanceof GameError) {
        this.sendError(socket, parsed.data.commandId, error.code, error.message);
        return;
      }
      throw error;
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    if (!this.room) return;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) return;
    const replacement = this.ctx
      .getWebSockets(`player:${attachment.playerId}`)
      .some((candidate) => candidate !== socket && candidate.readyState < 2);
    if (replacement) return;
    const player = this.room.players.find((candidate) => candidate.id === attachment.playerId);
    if (player && player.disconnectedAt === null) {
      const now = Date.now();
      player.disconnectedAt = now;
      this.room.revision += 1;
      this.room.lastActivityAt = now;
      this.room.expiresAt = now + 24 * 60 * 60 * 1_000;
      await this.persist();
      this.broadcast();
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    if (Date.now() < this.room.expiresAt) {
      await this.ctx.storage.setAlarm(this.room.expiresAt);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(4004, "Room expired");
    await this.ctx.storage.deleteAll();
    this.room = null;
  }
}
