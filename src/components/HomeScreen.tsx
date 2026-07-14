import { useState, type FormEvent } from "react";

interface HomeScreenProps {
  busy: boolean;
  error: string | null;
  initialRoomCode: string;
  onCreate: (displayName: string) => void;
  onJoin: (displayName: string, roomCode: string) => void;
}

export function HomeScreen({ busy, error, initialRoomCode, onCreate, onJoin }: HomeScreenProps) {
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());

  function create(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (name) onCreate(name);
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    const code = roomCode.trim().toUpperCase();
    if (name && code) onJoin(name, code);
  }

  return (
    <main className="home-screen">
      <div className="home-mark" aria-hidden="true">
        <span>↯</span>
      </div>
      <header className="home-copy">
        <h1>Screw the Dealer</h1>
        <p>One deck. Two guesses. Don’t get stuck dealing.</p>
      </header>

      <div className="entry-panel">
        <label className="field-label" htmlFor="display-name">
          Your name
        </label>
        <input
          id="display-name"
          autoComplete="nickname"
          maxLength={20}
          placeholder="Ava"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <form onSubmit={create}>
          <button className="primary-button" disabled={busy || !displayName.trim()} type="submit">
            {busy ? "Setting the table…" : "Create a game"}
          </button>
        </form>

        <div className="or-rule" aria-hidden="true">
          <span>or</span>
        </div>

        <form onSubmit={join}>
          <label className="field-label" htmlFor="room-code">
            Room code
          </label>
          <input
            id="room-code"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            placeholder="NIGHT7"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
          />
          <button className="secondary-button" disabled={busy || !displayName.trim() || roomCode.length !== 6} type="submit">
            Join game
          </button>
        </form>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>

      <p className="responsible-note">Drink responsibly. Alcohol is optional.</p>
      <details className="rules-card">
        <summary>How to play</summary>
        <ol>
          <li>The dealer draws a card face-down. The guesser calls its value.</li>
          <li>Right first time: dealer drinks 4. Otherwise, the dealer says higher or lower.</li>
          <li>Right second time: dealer drinks 2. Miss again: guesser drinks 1.</li>
          <li>After three missed rounds, the deal moves left. A correct round resets the count.</li>
        </ol>
      </details>
    </main>
  );
}
