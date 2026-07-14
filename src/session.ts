import { SessionCredentialsSchema, type SessionCredentials } from "../shared/protocol";

const LAST_ROOM_KEY = "screwdealer.last-room.v1";

function sessionKey(roomCode: string): string {
  return `screwdealer.session.v1.${roomCode.toUpperCase()}`;
}

export function saveSession(credentials: SessionCredentials): void {
  localStorage.setItem(sessionKey(credentials.roomCode), JSON.stringify(credentials));
  localStorage.setItem(LAST_ROOM_KEY, credentials.roomCode);
}

export function loadSession(roomCode?: string | null): SessionCredentials | null {
  const code = roomCode?.toUpperCase() || localStorage.getItem(LAST_ROOM_KEY);
  if (!code) return null;
  const raw = localStorage.getItem(sessionKey(code));
  if (!raw) return null;
  try {
    const parsed = SessionCredentialsSchema.parse(JSON.parse(raw));
    return parsed;
  } catch {
    localStorage.removeItem(sessionKey(code));
    if (localStorage.getItem(LAST_ROOM_KEY) === code) localStorage.removeItem(LAST_ROOM_KEY);
    return null;
  }
}

export function clearSession(roomCode: string): void {
  localStorage.removeItem(sessionKey(roomCode));
  if (localStorage.getItem(LAST_ROOM_KEY) === roomCode.toUpperCase()) localStorage.removeItem(LAST_ROOM_KEY);
}

export function socketUrl(apiUrl: string, credentials: SessionCredentials): string {
  const url = new URL(`/api/rooms/${credentials.roomCode}/socket`, apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", credentials.playerId);
  url.searchParams.set("resumeToken", credentials.resumeToken);
  return url.toString();
}

export { LAST_ROOM_KEY };
