import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen", () => {
  it("creates a game with a trimmed display name", () => {
    const onCreate = vi.fn();
    render(<HomeScreen busy={false} error={null} initialRoomCode="" onCreate={onCreate} onJoin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "  Ava  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create a game" }));

    expect(onCreate).toHaveBeenCalledWith("Ava");
    expect(screen.getByText("Drink responsibly. Alcohol is optional.")).toBeVisible();
    expect(screen.getByText("How to play")).toBeVisible();
  });

  it("normalizes a shared room code before joining", () => {
    const onJoin = vi.fn();
    render(<HomeScreen busy={false} error={null} initialRoomCode="night7" onCreate={vi.fn()} onJoin={onJoin} />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(onJoin).toHaveBeenCalledWith("Ben", "NIGHT7");
  });
});
