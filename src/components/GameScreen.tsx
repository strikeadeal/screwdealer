import { useMemo, useState } from "react";
import type { ClientCommand, PublicPlayer, PublicRoomSnapshot, Rank } from "../../shared/protocol";
import { useGracePeriodClock } from "../useGracePeriodClock";

type CommandType = ClientCommand["type"];

interface GameScreenProps {
  snapshot: PublicRoomSnapshot;
  selfId: string;
  connectionStatus: "idle" | "connecting" | "connected" | "reconnecting" | "offline";
  onCommand: (type: CommandType, payload: ClientCommand["payload"]) => void;
  onShare: () => void;
  onLeave: () => void;
}

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

function rankLabel(rank: number): string {
  return rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
}

function playerStatus(player: PublicPlayer, snapshot: PublicRoomSnapshot): string | null {
  if (player.id === snapshot.dealerId) return "Dealer";
  if (player.id === snapshot.guesserId) return "Guesser";
  if (player.role === "spectator") return "Watching";
  return null;
}

function PlayerRail({ snapshot }: { snapshot: PublicRoomSnapshot }) {
  return (
    <div className="player-rail" aria-label="Players">
      {snapshot.players.map((player) => (
        <div
          className={`player-chip${player.id === snapshot.guesserId ? " is-active" : ""}${!player.connected ? " is-offline" : ""}`}
          key={player.id}
        >
          <span className="player-avatar">{player.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="player-name">{player.displayName}</span>
          {playerStatus(player, snapshot) ? <span className="player-role">{playerStatus(player, snapshot)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function CardBack() {
  return (
    <div className="playing-card card-back" aria-label="Face-down card">
      <div className="card-back-frame"><span aria-hidden="true">↯</span></div>
    </div>
  );
}

function FaceCard({ rank, suit }: { rank: number; suit: string }) {
  const symbol = suit === "hearts" ? "♥" : suit === "diamonds" ? "♦" : suit === "clubs" ? "♣" : "♠";
  const red = suit === "hearts" || suit === "diamonds";
  return (
    <div className={`playing-card face-card${red ? " is-red" : ""}`} aria-label={`${rankLabel(rank)} of ${suit}`}>
      <span className="corner-rank">{rankLabel(rank)}</span>
      <span className="suit-mark">{symbol}</span>
    </div>
  );
}

function BoardHistory({ snapshot }: { snapshot: PublicRoomSnapshot }) {
  return (
    <section className="board-history" aria-label="Board history">
      <div className="section-rule"><span>Board history</span></div>
      <div className="card-rail">
        {snapshot.board.length === 0 ? <p>No cards turned yet</p> : null}
        {snapshot.board.map((card) => (
          <FaceCard key={card.id} rank={card.rank} suit={card.suit} />
        ))}
      </div>
    </section>
  );
}

export function GameScreen({ snapshot, selfId, connectionStatus, onCommand, onShare, onLeave }: GameScreenProps) {
  const now = useGracePeriodClock();
  const self = snapshot.players.find((player) => player.id === selfId);
  const dealer = snapshot.players.find((player) => player.id === snapshot.dealerId);
  const guesser = snapshot.players.find((player) => player.id === snapshot.guesserId);
  const isDealer = selfId === snapshot.dealerId;
  const isGuesser = selfId === snapshot.guesserId;
  const allowed: readonly number[] = snapshot.phase === "second_guess" ? snapshot.allowedGuesses : RANKS;
  const [selectedRank, setSelectedRank] = useState<Rank>((allowed[0] ?? 7) as Rank);
  const effectiveRank = (allowed.includes(selectedRank) ? selectedRank : (allowed[0] ?? 7)) as Rank;
  const host = snapshot.players.find((player) => player.id === snapshot.hostPlayerId);
  const nextHost = snapshot.players
    .filter((player) => player.role === "player" && player.connected)
    .toSorted((left, right) => (left.seat ?? 0) - (right.seat ?? 0))[0];
  const canClaimHost =
    nextHost?.id === selfId &&
    host?.disconnectedAt !== null &&
    host?.disconnectedAt !== undefined &&
    now - host.disconnectedAt >= 60_000;
  const removablePlayers = self?.isHost
    ? snapshot.players.filter(
        (player) =>
          player.id !== selfId &&
          !player.connected &&
          player.disconnectedAt !== null &&
          now - player.disconnectedAt >= 60_000,
      )
    : [];
  const connectionLabel = connectionStatus === "connected" ? "Connected" : connectionStatus === "offline" ? "Offline" : "Reconnecting";

  const resultCopy = useMemo(() => {
    const result = snapshot.roundResult;
    if (!result) return null;
    const drinker = snapshot.players.find((player) => player.id === result.drinkerId)?.displayName ?? "Player";
    return `${drinker} drinks ${result.drinks}`;
  }, [snapshot.players, snapshot.roundResult]);

  return (
    <main className="game-screen">
      <header className="room-header">
        <button className="room-code-button" onClick={onShare} type="button">
          <span>Room code</span>
          <strong>{snapshot.code}</strong>
        </button>
        <div className={`connection-badge${connectionStatus === "connected" ? "" : " is-disconnected"}`}><span /> {connectionLabel}</div>
        <button className="game-leave-button" onClick={onLeave} type="button" aria-label="Leave game">×</button>
      </header>

      <PlayerRail snapshot={snapshot} />

      <section className="game-stage">
        <p className="streak-label">Dealer streak <strong>{snapshot.missStreak}</strong> / 3</p>

        {snapshot.paused ? (
          <div className="state-message reconnect-card">
            <div className="pulse-icon" aria-hidden="true" />
            <h1>Waiting for a player to reconnect</h1>
            <p>The turn will continue from this exact card.</p>
          </div>
        ) : snapshot.phase === "awaiting_deal" || snapshot.phase === "round_result" ? (
          <div className="turn-panel">
            {snapshot.roundResult ? (
              <>
                <h1>{resultCopy}</h1>
                <FaceCard rank={snapshot.roundResult.card.rank} suit={snapshot.roundResult.card.suit} />
              </>
            ) : (
              <>
                <h1>{isDealer ? "Your deal" : `${dealer?.displayName ?? "Dealer"} is dealing`}</h1>
                <CardBack />
              </>
            )}
            {isDealer ? (
              <button className="primary-button deal-button" onClick={() => onCommand("deal", {})} type="button">
                {snapshot.roundResult ? "Deal next card" : "Deal the card"}
              </button>
            ) : (
              <p className="watching-copy">Keep your cards close. Your turn is coming.</p>
            )}
          </div>
        ) : snapshot.phase === "finished" ? (
          <div className="results-panel">
            <h1>Deck finished</h1>
            <p>One last look at the damage.</p>
            <ol>
              {snapshot.players.filter((player) => player.role === "player").toSorted((a, b) => b.drinks - a.drinks).map((player) => (
                <li key={player.id}>
                  <span className="result-player">
                    <b>{player.displayName}</b>
                    <small>{player.stats.firstGuessHits} first · {player.stats.secondGuessHits} second · {player.stats.misses} misses</small>
                  </span>
                  <strong>{player.drinks} drinks</strong>
                </li>
              ))}
            </ol>
            {self?.isHost ? <button className="primary-button" onClick={() => onCommand("rematch", {})} type="button">Run it back</button> : <p>Waiting for the host to rematch.</p>}
          </div>
        ) : (
          <div className="guess-panel">
            <h1>{isGuesser ? `${self?.displayName}, call the card` : `${guesser?.displayName ?? "Guesser"} is calling`}</h1>
            {snapshot.hint ? <p className="hint-copy">{snapshot.hint} than {rankLabel(snapshot.firstGuess ?? 1)}</p> : null}
            <CardBack />
            {isGuesser ? (
              <>
                <div className="rank-picker" aria-label="Card value">
                  {RANKS.map((rank) => (
                    <button
                      aria-label={`Choose ${rankLabel(rank)}`}
                      className={effectiveRank === rank ? "is-selected" : ""}
                      disabled={!allowed.includes(rank)}
                      key={rank}
                      onClick={() => setSelectedRank(rank)}
                      type="button"
                    >
                      {rankLabel(rank)}
                    </button>
                  ))}
                </div>
                <button className="primary-button lock-button" onClick={() => onCommand("guess", { rank: effectiveRank })} type="button">
                  Lock in {rankLabel(effectiveRank)}
                </button>
              </>
            ) : (
              <p className="watching-copy">{self?.role === "spectator" ? "You’re watching this deck. You’ll take a seat in the rematch." : "Watch the board. Every revealed card helps."}</p>
            )}
          </div>
        )}

        <p className="deck-count">▱ {snapshot.cardsRemaining} cards left</p>
      </section>

      <BoardHistory snapshot={snapshot} />
      {canClaimHost || removablePlayers.length > 0 ? (
        <section className="host-controls" aria-label="Host controls">
          {canClaimHost ? <button className="secondary-button" onClick={() => onCommand("claim_host", {})} type="button">Claim host</button> : null}
          {removablePlayers.map((player) => (
            <button className="text-button" key={player.id} onClick={() => onCommand("remove_player", { playerId: player.id })} type="button">
              Remove {player.displayName}
            </button>
          ))}
        </section>
      ) : null}
    </main>
  );
}
