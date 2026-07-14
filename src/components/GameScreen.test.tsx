import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicRoomSnapshot } from "../../shared/protocol";
import { GameScreen } from "./GameScreen";

const players: PublicRoomSnapshot["players"] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Ava",
    role: "player",
    seat: 0,
    drinks: 0,
    stats: { firstGuessHits: 0, secondGuessHits: 0, misses: 0 },
    connected: true,
    disconnectedAt: null,
    isHost: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Ben",
    role: "player",
    seat: 1,
    drinks: 0,
    stats: { firstGuessHits: 0, secondGuessHits: 0, misses: 0 },
    connected: true,
    disconnectedAt: null,
    isHost: false,
  },
];

function snapshot(overrides: Partial<PublicRoomSnapshot> = {}): PublicRoomSnapshot {
  return {
    version: 1,
    code: "NIGHT7",
    revision: 4,
    phase: "second_guess",
    players,
    hostPlayerId: players[0].id,
    dealerId: players[0].id,
    guesserId: players[1].id,
    missStreak: 2,
    firstGuess: 7,
    hint: "higher",
    allowedGuesses: [8, 9, 10, 11, 12, 13],
    roundResult: null,
    board: [],
    cardsRemaining: 47,
    paused: false,
    ...overrides,
  };
}

describe("GameScreen", () => {
  it("restricts the second guess to values allowed by the server", () => {
    const onCommand = vi.fn();
    render(<GameScreen snapshot={snapshot()} selfId={players[1].id} connectionStatus="connected" onCommand={onCommand} onShare={vi.fn()} onLeave={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Choose 7" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose 10" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in 10" }));
    expect(onCommand).toHaveBeenCalledWith("guess", { rank: 10 });
  });

  it("shows a pause instead of controls when an active player disconnects", () => {
    render(<GameScreen snapshot={snapshot({ paused: true })} selfId={players[1].id} connectionStatus="offline" onCommand={vi.fn()} onShare={vi.fn()} onLeave={vi.fn()} />);

    expect(screen.getByText("Waiting for a player to reconnect")).toBeVisible();
    expect(screen.getByText("Offline", { exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument();
  });

  it("shows the deal control only to the dealer", () => {
    const onCommand = vi.fn();
    render(
      <GameScreen
        snapshot={snapshot({ phase: "awaiting_deal", firstGuess: null, hint: null, allowedGuesses: [] })}
        selfId={players[0].id}
        connectionStatus="connected"
        onCommand={onCommand}
        onShare={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deal the card" }));
    expect(onCommand).toHaveBeenCalledWith("deal", {});
  });

  it("keeps an explicit leave action available during a game", () => {
    const onLeave = vi.fn();
    render(<GameScreen snapshot={snapshot()} selfId={players[1].id} connectionStatus="connected" onCommand={vi.fn()} onShare={vi.fn()} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("shows drink totals and player statistics after the deck", () => {
    const finishedPlayers = [
      { ...players[0], drinks: 6, stats: { firstGuessHits: 1, secondGuessHits: 1, misses: 2 } },
      players[1],
    ];
    render(
      <GameScreen
        snapshot={snapshot({ phase: "finished", players: finishedPlayers, cardsRemaining: 0 })}
        selfId={players[0].id}
        connectionStatus="connected"
        onCommand={vi.fn()}
        onShare={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByText("6 drinks")).toBeVisible();
    expect(screen.getByText("1 first · 1 second · 2 misses")).toBeVisible();
  });

  it("lets the deterministic next player claim a host after the grace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const onCommand = vi.fn();
    const disconnectedAt = Date.now() - 61_000;
    const disconnectedPlayers = [
      { ...players[0], connected: false, disconnectedAt },
      players[1],
    ];
    render(
      <GameScreen
        snapshot={snapshot({ players: disconnectedPlayers, paused: true })}
        selfId={players[1].id}
        connectionStatus="connected"
        onCommand={onCommand}
        onShare={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Claim host" }));
    expect(onCommand).toHaveBeenCalledWith("claim_host", {});
    vi.useRealTimers();
  });
});
