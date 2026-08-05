# CLAUDE.md

Guidance for working in this repository.

## What this project is

**Poker Lab** — a client/server poker toolkit. It exists as a portfolio piece, so
the code is meant to be *read*: clarity, structure, and comments that explain
reasoning matter as much as behaviour.

Shipped: a Texas Hold'em equity calculator with persistent history.
Next up: a hand simulator, then a session tracker (see [Roadmap](#roadmap)).

## Commands

```bash
npm start          # run the server on http://localhost:3000
npm run dev        # same, with --watch auto-restart
npm test           # run the full suite (node:test, no test framework dependency)
npm run test:watch # re-run on change
npm run test:coverage
```

Environment: `PORT`, `HOST`, `NODE_ENV`, `DATA_DIR`, `MAX_HISTORY_RECORDS`,
`LOG_FORMAT`. All resolved in one place — [src/server/config.js](src/server/config.js).

Requires Node >= 20.11.

## Architecture

```
src/
  shared/poker/     Pure domain logic. Isomorphic — runs in Node AND the browser.
  server/           Express app: config, routes, services, store, middleware.
public/             Static frontend. Buildless native ES modules + CDN React.
test/shared/        Domain tests.
test/server/        Store and end-to-end API tests.
data/               JSON data store (contents gitignored).
```

Request flow: `route → service → domain` on the way in, `→ store` on the way out.

### The one rule that shapes everything: shared domain code

`src/shared/poker/` is served to the browser at `/shared/` (see the static mount
in [src/server/app.js](src/server/app.js)). Server code imports it by relative
path; client code imports it as `/shared/poker/cards.js`. **One implementation,
two consumers.**

This exists because the project previously had two hand evaluators — one in
`lib/poker.js`, one in `public/javascripts/poker/modules/evaluator.js` — that
disagreed with each other, and the buggy one was the one serving the API. Do not
reintroduce that split.

Consequences to respect:

- Anything in `src/shared/` must be **pure**: no `node:` imports, no `fs`, no
  `process`, no DOM. It has to parse and run in both runtimes.
- Randomness comes from an injected `Rng`, never `Math.random()` directly.
- Server-only concerns (persistence, HTTP, config) live in `src/server/`.

### Layer responsibilities

| Layer | Location | Rule |
|---|---|---|
| Domain | `src/shared/poker/` | Pure functions and classes. No I/O. Fully unit-testable. |
| Service | `src/server/services/` | Orchestrates domain + store. Takes dependencies via constructor injection. |
| Route | `src/server/routes/` | Thin: parse, delegate, respond. Built by a `createXRouter({deps})` factory so tests can inject stubs. |
| Store | `src/server/store/` | Persistence behind the `DataStore` interface. |

`createApp({historyRepository})` accepts an injected repository — that is how the
API tests run against a temp directory instead of real data.

## Conventions

**ES modules everywhere.** `"type": "module"`. Use `import`/`export`, never
`require`. Node built-ins use the `node:` prefix (`import fs from 'node:fs/promises'`).

**Dependencies: minimise them.** Prefer built-in Node/browser APIs or a small
amount of hand-written code over adding a package. Before adding one, check
whether the need can be met without it. Genuinely justified packages (`express`)
stay; don't reach for a library for something easy to write directly. The test
suite uses `node:test` and `node:assert` for exactly this reason, and the API
tests use global `fetch` rather than a test HTTP client.

**Comments explain *why*, not *what*.** Every module opens with a block comment
stating its purpose and any non-obvious design decision. Inline comments are for
reasoning that isn't visible in the code — a subtle invariant, a rejected
alternative, a bug being guarded against. Don't narrate what the next line
plainly does.

**JSDoc on exported functions and classes**, including `@param`/`@returns`.
There's no TypeScript; JSDoc is what gives editors type information.

**Naming.** Classes `PascalCase`, functions and variables `camelCase`, module
constants `SCREAMING_SNAKE_CASE`, files match their primary export
(`JsonFileStore.js`, `handEvaluator.js`).

**Errors.** Throw `ApiError` for anything a client should see. Anything else is
treated as an unexpected fault: logged in full, reported as a generic 500.
Never leak stack traces in production.

**Async Express handlers** must be wrapped in `asyncHandler` — Express 4 does not
forward promise rejections, so an unwrapped `async` route hangs on throw.

## Domain notes

Cards are two-character strings: rank + suit, e.g. `'As'`, `'Th'`, `'2c'`.

`evaluateHand(cards)` returns `{category, tiebreaks, name}`. Comparison is
lexicographic over `[category, ...tiebreaks]`, which makes `compareHands` a total
ordering with no special cases. Tiebreaks are written in the order the rules
resolve ties (full house is `[trips, pair]`; two pair is `[high, low, kicker]`).

Two evaluator traps that have already bitten this codebase — both now covered by
tests, keep them passing:

1. **The wheel.** `A-2-3-4-5` is a straight to the five. Handled by adding a
   rank-1 alias when an ace is present.
2. **Flush + off-suit straight ≠ straight flush.** The straight must be checked
   *within the flush suit*, not across all seven cards.

`calculateEquity` picks its own strategy: it enumerates every runout exactly when
there are ≤ 200,000 of them (river = 1, turn = 44, flop = 990) and samples with a
seeded RNG otherwise (preflop = 1,712,304). The `method` field reports which was
used — surface it in any UI, because "exact" and "sampled" are different claims.

## Data store

`DataStore` (abstract) → `JsonFileStore` (JSON files) → `HistoryRepository`
(domain-level API). Services depend on the repository, never on a concrete store,
so swapping in SQLite means one new class and one line in
[src/server/store/index.js](src/server/store/index.js).

`JsonFileStore` guards three specific failure modes; don't regress them:

- **Torn writes** — writes go to a temp file then `rename` (atomic on POSIX and NTFS).
- **Interleaved writes** — all flushes are serialised on a promise chain.
- **Concurrent init** — the load promise is memoised. Without this, N concurrent
  `insert()` calls each start their own load and the last one to finish wipes
  the others' records. There is a test for this.

History records store the request, the result, *and the seed*. A stored result is
only meaningful if the run can be replayed.

## Testing

`node:test` with `describe`/`it`. `npm test` discovers `**/*.test.js`.

- Domain tests go in `test/shared/`, server tests in `test/server/`.
- Prefer assertions that are **provable by hand** (a locked-up nut hand is 100%;
  identical boards split 50/50) over published percentages. Where a statistical
  assertion is unavoidable, use a fixed seed and a wide band.
- Store and API tests must use a temp directory (`fs.mkdtemp`) — never touch
  `data/`.
- API tests boot the real app on an ephemeral port and drive it with `fetch`.

## Frontend

Buildless by design: native ES modules served directly, React loaded as a UMD
global from a CDN, and `React.createElement` instead of JSX.

The tradeoff is deliberate — no toolchain to explain, and the shared domain
modules import cleanly in both runtimes. The cost is verbose element code and
CDN React. **Revisit when** the component tree grows past comfortable
`createElement` nesting, or when deploying for real (the CDN currently serves
development builds). At that point add Vite; the module layout is already
compatible.

Client structure: `main.js` (bootstrap) → `PokerApp.js` (state) →
`components/` (presentational) + `hooks/` (stateful logic) + `services/`
(API access). All fetch calls go through `services/apiClient.js`, which
normalises the server's `{error: {message, details}}` shape into thrown
`ApiRequestError`s — components only ever handle exceptions.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/equity` | Calculate equity; records history |
| `GET` | `/api/history` | Page of records, newest first (`limit`, `offset`, `type`) |
| `GET` | `/api/history/stats` | Aggregate counts |
| `GET` | `/api/history/:id` | Single record |
| `DELETE` | `/api/history/:id` | Delete one |
| `DELETE` | `/api/history` | Clear all |

Everything under `/api`. Non-API paths fall through to `index.html` so
client-side routing survives a hard refresh; API 404s stay real 404s.

## Roadmap

Keep this section current — it is how a new session learns what "next" means.

1. **Poker simulator** *(next)* — deal full hands from a seeded `Deck`, run
   configurable spots, record results as `RECORD_TYPES.SIMULATION`. The pieces
   already in place for it: `Deck`, `Rng`, `findWinners`, and the record-type
   discriminator in `HistoryRepository`.
2. **Session tracker** — aggregate stored records into trends over time.
3. **PR process** — GitHub Actions running `npm test`, plus build artifacts.

## Gotchas

- `data/` contents are gitignored; `data/.gitkeep` is tracked so the directory exists.
- Cards are case-normalised at the validation boundary (`normalizeCard`), so
  domain code can assume canonical form.
- `combinations()` **reuses its output array** for every yield — copy it if you
  need to retain it beyond the loop iteration.
- The equity engine credits split pots fractionally, so every player's equity
  sums to exactly 1. Don't "fix" this to whole-number win counts.
