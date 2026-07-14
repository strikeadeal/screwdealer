# Screw the Dealer

A mobile-first, account-free multiplayer PWA for the party card game. The React client is hosted at `https://strikeadeal.github.io/screwdealer/`; each room is authoritative in a SQLite-backed Cloudflare Durable Object and synchronized over hibernating WebSockets.

> Drink responsibly. Alcohol is optional.

## Play

1. One player creates a room and shares its six-character code or invite link.
2. Two to eight uniquely named players join from their own phones.
3. The dealer draws a hidden card and the guesser calls its value.
4. A first-guess hit makes the dealer drink 4. Otherwise the dealer reveals higher/lower.
5. A second-guess hit makes the dealer drink 2; a miss makes the guesser drink 1.
6. The guess moves left after every card. Three missed rounds rotate the dealer; a correct guess resets that streak.

Late arrivals watch until the next deck. The game shows drink totals and per-player stats after all 52 cards, then the host can start a rematch.

## Local development

Requires Node 24+.

```sh
npm ci
npm run dev:worker
```

In another terminal:

```sh
npm run dev
```

Open `http://localhost:5173/screwdealer/`. The Vite client talks to the local Worker at `http://localhost:8787` by default.

Useful checks:

```sh
npm run check
npm run test:e2e
```

The browser test launches two isolated iPhone/WebKit contexts and covers room creation, joining, a complete round, refresh recovery, an offline transition, and reconnect.

## Architecture

- `src/` — React PWA, versioned room session storage, socket lifecycle, and responsive game UI.
- `shared/` — Zod-validated HTTP, command, credential, and public snapshot contracts used by both runtimes.
- `worker/` — Worker router, game reducer, token security, and `RoomDurableObject`.
- `test/e2e/` — multi-client mobile WebKit journey, also used as the production smoke test.
- `docs/design/` — approved visual reference and implementation notes.

The Durable Object persists the shuffled deck, hidden card, token hashes, command idempotency window, seats, and expiry. Clients receive only sanitized snapshots. A room expires 24 hours after meaningful activity; player seats survive disconnects, and active turns pause until the dealer and guesser are online.

## Deployment

The single GitHub Actions pipeline verifies every pull request. A verified push to `main` deploys the Worker using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, injects the returned Worker URL into the Vite build, deploys `dist` to GitHub Pages, then repeats the two-client journey against production.

The repository’s Pages source must be set to GitHub Actions. Worker browser origins are limited to the production Pages origin and local development origins in `wrangler.jsonc`.
