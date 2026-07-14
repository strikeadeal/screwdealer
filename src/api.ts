import { SessionCredentialsSchema, type SessionCredentials } from "../shared/protocol";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8787";

async function requestSession(path: string, displayName: string): Promise<SessionCredentials> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const body = (await response.json()) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? "Could not reach the room.");
  return SessionCredentialsSchema.parse(body);
}

export function createRoom(displayName: string): Promise<SessionCredentials> {
  return requestSession("/api/rooms", displayName);
}

export function joinRoom(displayName: string, roomCode: string): Promise<SessionCredentials> {
  return requestSession(`/api/rooms/${encodeURIComponent(roomCode)}/join`, displayName);
}
