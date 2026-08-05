# Poker Lab

A client/server poker toolkit built on Node, Express, and React — a Texas
Hold'em equity calculator with a persistent calculation history, and the
foundation for a hand simulator and session tracker.

Built as a portfolio project, so the emphasis is on architecture that holds up
under reading: a pure domain layer shared verbatim between server and browser,
dependency-injected services, a swappable data store, and tests that assert on
provable poker facts rather than on coincidence.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

```bash
npm run dev    # auto-restart on change
npm test       # 127 tests, no test framework dependency
```

Requires **Node 20.11 or newer**. No build step — the frontend is served as
native ES modules.

## What it does

Pick hole cards for two to six players, optionally set a flop, turn, or river,
and get each player's equity.

The engine chooses its own strategy and tells you which it used:

| Known board | Possible runouts | Strategy |
|---|---|---|
| River | 1 | **Exact** — enumerated |
| Turn | 44 | **Exact** — enumerated |
| Flop | 990 | **Exact** — enumerated |
| Preflop | 1,712,304 | **Monte Carlo** — seeded sampling |

Anything up to 200,000 runouts is exhausted exhaustively, so the answer has no
sampling error at all. Beyond that it samples from a seeded PRNG, and the seed
is stored with the result — which is what makes a saved run reproducible rather
than merely recorded.

Every calculation is written to a JSON-backed store and shown in a history panel
that can reload a past spot back into the form.

## Architecture

```
src/
  shared/poker/          Pure domain — runs in Node AND the browser
    cards.js               Card primitives, deck construction, board assembly
    deck.js                Stateful shufflable deck
    handEvaluator.js       5–7 card evaluation and comparison
    equity.js              Exact enumeration + Monte Carlo equity
    rng.js                 Seedable PRNG (mulberry32)
    validation.js          Request validation, shared by client and server
  server/
    app.js                 Express assembly (exported as a factory)
    server.js              Process lifecycle: bind, log, graceful shutdown
    config.js              All environment resolution, in one place
    routes/                Thin HTTP handlers built by dependency-taking factories
    services/              Orchestration between domain and store
    store/                 DataStore → JsonFileStore → HistoryRepository
    middleware/            Error handling, async wrapper
    errors/                ApiError
public/                  Buildless frontend
  javascripts/poker/
    main.js                Bootstrap
    PokerApp.js            Root component and selection state
    components/            Presentational components
    hooks/                 Stateful logic (useHistory)
    services/apiClient.js  All network access
test/
  shared/                Domain tests
  server/                Store and end-to-end API tests
data/                    JSON store (contents gitignored)
```

### One domain, two runtimes

`src/shared/poker/` is mounted at `/shared/`, so the browser imports the exact
same evaluator the API runs:

```js
// server
import { calculateEquity } from '../../shared/poker/index.js';

// browser
import { SUIT_META } from '/shared/poker/cards.js';
```

No duplication, no build step, and no drift between what the UI validates and
what the server enforces.

### Layered server

```
HTTP request → route → service → domain
                          ↓
                    repository → store → disk
```

Routes are created by factories that receive their dependencies
(`createEquityRouter({equityService})`), and `createApp()` accepts an injected
repository. That is what lets the API test suite boot the real middleware stack
against a temp directory.

### Data store

`DataStore` defines the contract; `JsonFileStore` implements it over JSON files;
`HistoryRepository` exposes a domain-level API on top. Services depend on the
repository, so moving to SQLite or Postgres means one new class and one changed
line.

The file store is small but not naive — it guards against torn writes (temp file
plus atomic rename), interleaved writes (a serialised flush chain), concurrent
initialisation, and corrupt files on load (quarantined rather than fatal).

## API

All endpoints live under `/api` and speak JSON, including errors.

### `POST /api/equity`

```json
{
  "players": [["As", "Ah"], ["Kd", "Kc"]],
  "board": ["2c", "7d", "9h"],
  "dead": [],
  "iterations": 20000,
  "seed": "optional-for-reproducibility",
  "label": "optional name for the history record"
}
```

```json
{
  "players": [
    { "index": 0, "cards": ["As", "Ah"], "equity": 0.9162, "win": 0.9162, "tie": 0 },
    { "index": 1, "cards": ["Kd", "Kc"], "equity": 0.0838, "win": 0.0838, "tie": 0 }
  ],
  "board": ["2c", "7d", "9h"],
  "method": "exact",
  "iterations": 990,
  "possibleRunouts": 990,
  "seed": null,
  "durationMs": 14,
  "historyId": "97033e47-27ad-4042-bc69-7dd15e973b6e"
}
```

Cards are `rank + suit`: ranks `23456789TJQKA`, suits `shdc`. Input is
case-normalised, so `as` and `AS` both mean the ace of spades.

### Other endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/history` | Records, newest first (`limit`, `offset`, `type`) |
| `GET` | `/api/history/stats` | Aggregate counts |
| `GET` | `/api/history/:id` | A single record |
| `DELETE` | `/api/history/:id` | Delete one record |
| `DELETE` | `/api/history` | Clear all records |

Errors are consistently shaped, with field-level detail where it exists:

```json
{
  "error": {
    "message": "The equity request is invalid.",
    "code": "BAD_REQUEST",
    "details": ["Each card may only be used once. Duplicated: As."]
  }
}
```

## Testing

```bash
npm test
```

127 tests via Node's built-in runner — no Jest, Mocha, or Chai.

The domain tests deliberately favour assertions that are **provable by hand**
over published percentages: a player holding the nut straight flush on a
complete board has exactly 100% equity, two players playing the same board split
exactly 50/50, and every player's equity sums to exactly 1. Statistical
assertions use a fixed seed and a wide band, so a failure means a real
regression rather than an unlucky sample.

They also lock down the two places poker evaluators usually break:

- the **wheel** — `A-2-3-4-5` is a straight to the five; and
- a **flush plus an off-suit straight**, which is a flush, not a straight flush.

API tests boot the real Express app on an ephemeral port and drive it with
`fetch`; store tests run against `fs.mkdtemp` directories and never touch `data/`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Controls error verbosity and log format |
| `DATA_DIR` | `./data` | Where the JSON store lives |
| `MAX_HISTORY_RECORDS` | `500` | Retention cap; oldest evicted first |
| `LOG_FORMAT` | `dev` / `combined` | morgan format |

## Tech stack

**Backend** — Node 20+, Express 4, ES modules throughout.
**Frontend** — React 18 (UMD via CDN), native ES modules, no build step.
**Data** — JSON file store behind a swappable interface.
**Testing** — `node:test` and `node:assert`.

Dependencies are kept deliberately minimal: three runtime packages
(`express`, `morgan`, `cookie-parser`) and zero dev dependencies. The frontend
uses `React.createElement` rather than JSX so it runs in the browser untouched;
see [CLAUDE.md](CLAUDE.md) for when that tradeoff should be revisited.

## Roadmap

- [x] Equity calculator with exact enumeration and seeded Monte Carlo
- [x] Persistent calculation history with replay
- [ ] **Hand simulator** — deal and play out configurable spots from a seeded deck
- [ ] **Session tracker** — aggregate stored results into trends over time
- [ ] CI pipeline (GitHub Actions) with test runs and build artifacts
- [ ] Database-backed store

## Notes

The CDN currently serves React's **development** builds, which are larger and
slower. Switch to `react.production.min.js` in
[public/index.html](public/index.html) before any real deployment.
