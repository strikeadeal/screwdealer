import { useState } from "react";
import { createRoom, joinRoom } from "./api";
import { GameScreen } from "./components/GameScreen";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { loadSession } from "./session";
import { shareRoomInvite } from "./share";
import { useRoomSession } from "./useRoomSession";

function roomFromUrl(): string {
  return new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
}

export default function App() {
  const [initialRoomCode] = useState(roomFromUrl);
  const [initialSession] = useState(() => loadSession(initialRoomCode || null));
  const room = useRoomSession(initialSession);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function create(displayName: string) {
    setBusy(true);
    room.setError(null);
    try {
      room.begin(await createRoom(displayName));
    } catch (error) {
      room.setError(error instanceof Error ? error.message : "Could not create a room.");
    } finally {
      setBusy(false);
    }
  }

  async function join(displayName: string, roomCode: string) {
    setBusy(true);
    room.setError(null);
    try {
      room.begin(await joinRoom(displayName, roomCode));
    } catch (error) {
      room.setError(error instanceof Error ? error.message : "Could not join that room.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!room.credentials) return;
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    url.searchParams.set("room", room.credentials.roomCode);
    try {
      const result = await shareRoomInvite(url.toString(), room.credentials.roomCode);
      setToast(result === "shared" ? "Invite sent" : "Invite link copied");
      window.setTimeout(() => setToast(null), 2_000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      room.setError("Could not share the room link.");
    }
  }

  function leave() {
    if (!room.snapshot) {
      room.forget();
      return;
    }
    room.command("leave", {});
    window.setTimeout(() => {
      room.forget();
      window.history.replaceState({}, "", import.meta.env.BASE_URL);
    }, 150);
  }

  if (!room.credentials) {
    return <HomeScreen busy={busy} error={room.error} initialRoomCode={initialRoomCode} onCreate={create} onJoin={join} />;
  }

  if (!room.snapshot) {
    return (
      <main className="connection-screen">
        <div className="loader-screw" aria-hidden="true">↯</div>
        <h1>{room.status === "offline" ? "You’re offline" : "Pulling up a chair"}</h1>
        <p>{room.status === "offline" ? "Reconnect to Wi-Fi or mobile data to rejoin." : `Joining room ${room.credentials.roomCode}…`}</p>
        {room.error ? <p className="form-error" role="alert">{room.error}</p> : null}
        <button className="text-button" onClick={room.forget} type="button">Back to home</button>
      </main>
    );
  }

  return (
    <>
      {room.snapshot.phase === "lobby" ? (
        <LobbyScreen snapshot={room.snapshot} selfId={room.credentials.playerId} onCommand={room.command} onShare={share} onLeave={leave} />
      ) : (
        <GameScreen snapshot={room.snapshot} selfId={room.credentials.playerId} connectionStatus={room.status} onCommand={room.command} onShare={share} onLeave={leave} />
      )}
      {room.status !== "connected" ? <div className="connection-ribbon" role="status">{room.status === "offline" ? "Offline" : "Reconnecting…"}</div> : null}
      {room.error ? <button className="error-toast" onClick={() => room.setError(null)} type="button">{room.error}</button> : null}
      {toast ? <div className="success-toast" role="status">{toast}</div> : null}
    </>
  );
}
