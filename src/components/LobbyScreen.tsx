import type { ClientCommand, PublicRoomSnapshot } from "../../shared/protocol";
import { useGracePeriodClock } from "../useGracePeriodClock";

type CommandType = ClientCommand["type"];

interface LobbyScreenProps {
  snapshot: PublicRoomSnapshot;
  selfId: string;
  onCommand: (type: CommandType, payload: ClientCommand["payload"]) => void;
  onShare: () => void;
  onLeave: () => void;
}

export function LobbyScreen({ snapshot, selfId, onCommand, onShare, onLeave }: LobbyScreenProps) {
  const now = useGracePeriodClock();
  const self = snapshot.players.find((player) => player.id === selfId);
  const seated = snapshot.players.filter((player) => player.role === "player");
  const connectedSeated = seated.filter((player) => player.connected);
  const host = snapshot.players.find((player) => player.id === snapshot.hostPlayerId);
  const canClaimHost =
    !self?.isHost &&
    host?.disconnectedAt !== null &&
    host?.disconnectedAt !== undefined &&
    now - host.disconnectedAt >= 60_000;

  return (
    <main className="lobby-screen">
      <header className="lobby-header">
        <div>
          <span>Room code</span>
          <h1>{snapshot.code}</h1>
        </div>
        <button className="icon-button" aria-label="Share room" onClick={onShare} type="button">↗</button>
      </header>

      <section className="lobby-content">
        <div className="lobby-title-row"><h2>Players</h2><span>{seated.length} / 8</span></div>
        <ul className="lobby-list">
          {snapshot.players.map((player) => {
            const removable =
              self?.isHost &&
              player.id !== selfId &&
              !player.connected &&
              player.disconnectedAt !== null &&
              now - player.disconnectedAt >= 60_000;
            return (
              <li key={player.id}>
                <span className="player-avatar">{player.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="lobby-player-copy">
                  <strong>{player.displayName}</strong>
                  <small>{player.isHost ? "Host" : player.role === "spectator" ? "Watching this deck" : player.connected ? "Ready" : "Reconnecting"}</small>
                </span>
                <span className={`presence-dot${player.connected ? " is-online" : ""}`} aria-label={player.connected ? "Connected" : "Offline"} />
                {removable ? <button className="text-button" onClick={() => onCommand("remove_player", { playerId: player.id })} type="button">Remove</button> : null}
              </li>
            );
          })}
        </ul>

        {self?.isHost ? (
          <button className="primary-button" disabled={connectedSeated.length < 2} onClick={() => onCommand("start_game", {})} type="button">
            {connectedSeated.length < 2 ? "Waiting for players" : "Start game"}
          </button>
        ) : (
          <p className="waiting-host">Waiting for the host to start</p>
        )}
        {canClaimHost ? (
          <button className="secondary-button" onClick={() => onCommand("claim_host", {})} type="button">Claim host</button>
        ) : null}
        <button className="text-button leave-button" onClick={onLeave} type="button">Leave room</button>
      </section>
      <p className="responsible-note">Drink responsibly. Alcohol is optional.</p>
    </main>
  );
}
