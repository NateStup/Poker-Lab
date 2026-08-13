# Poker Lab

A client/server poker toolkit built on Node, Express, and React — a Texas
Hold'em odds calculator with persistent history and exact outs, a range
explorer for range-vs-hand and range-vs-range equity, a tournament manager
with a live blind clock and payouts, and a hand logger that replays a saved
hand action by action from a shareable link.

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
npm test       # 391 tests, no test framework dependency
```

Requires **Node 20.11 or newer**. No build step — the frontend is served as
native ES modules.

## What it does

**Odds Calculator.** Pick hole cards for two to ten players, optionally set
a flop, turn, or river, and get each player's equity.

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
that can reload a past spot back into the form. Whenever the board is a flop
or turn (heads-up only), the result also breaks down each player's **outs** —
the exact unseen cards that make them the winner or a chop on the very next
card, computed by enumeration rather than sampled.

**Range Explorer.** Paint a hero range on the standard 13x13 grid — by hand,
or with a "top X%" slider driven by the classic Chen Formula hand ranking —
choose an opponent (a specific hand or another range), and get equity for the
matchup. This always samples: averaging exact equities across every combo
pairing in two wide ranges is well over a million evaluations before a single
board card is dealt, so `calculateRangeEquity` instead draws one combo from
each side per iteration and deals the rest of the board, keeping the cost
roughly constant regardless of range width.

Every individual card position on both pages — a hole card, a board street's
card, the villain's hand — is a card-back until clicked, at which point a
picker popover opens scoped to just that one position. Ranges can also be
pasted or copied as standard shorthand (`22+,A5s+,KTo+`) via the range
notation box under each grid.

**Tournament Manager.** Register players, then run the event: each buy-in,
rebuy, and add-on feeds a running chip count and prize pool (no stack is ever
typed in by hand), and each elimination is assigned a finishing place by
counting down from the field size — the last player standing is
auto-declared the winner. A live blind clock (with a suggested structure you
can edit) counts down locally in the browser between server syncs, chimes on
every level change, and pauses/resumes/advances on command. A payout panel
computes amounts from the prize pool and a percentage split the moment there's
money in the pool, before anyone's even been eliminated.

**Hand Logger.** Recreate a hand you played on a table diagram — seats, stacks,
who was on the button — then log the betting street by street and write down
what you were thinking. Saving it produces a link that replays the hand action
by action: each street dealt, each bet pushed out in front of a seat and swept
into the middle, each fold greyed out, the pot settled at the end.

It is a logger, not a rules engine, and the line it holds is that impossible
*data* is rejected while merely odd *poker* is not. A turn dealt before a flop
or a card used twice is refused; betting after folding, a wild overbet, or a
call for less than the bet is accepted, because someone reconstructing a hand
from memory is far likelier than someone making a claim about the rules.

Two things are deliberately never typed in. **Forced bets are derived** — antes,
blinds and straddles come from the table format and the button, so the stored
action list holds only voluntary decisions. And there is **no winner picker**:
the hand already records the folds, the board and the holdings, so the result
is read off it rather than asked for a second time. When the cards genuinely
don't say — a villain who mucked unseen, a hand cut short — the pot shows as
unawarded and the page asks for the missing holding instead of guessing.

Amounts are street totals, the way poker is spoken: a big blind calling a raise
to 300 logs `call 300`, not "put in 200 more", and the pot maths subtracts what
that seat already has out rather than double-counting it. Actions are logged by
clicking the action rather than typing a number — the editor knows what the
acting seat faces, so it offers Fold, Check-or-Call, All in, and a slider with
½/¾/pot shortcuts. On an all-in run-out the replay prices each remaining hand
with the same equity engine the calculator uses, recomputed against the board on
every frame so it moves as the turn and river land.

## Architecture

```
src/
  shared/poker/          Pure poker domain — runs in Node AND the browser
    cards.js               Card primitives, deck construction, board assembly
    deck.js                Stateful shufflable deck
    handEvaluator.js       5–7 card evaluation and comparison
    equity.js              Exact enumeration + Monte Carlo equity
    outs.js                Exact outs (heads-up, incomplete board)
    ranges.js              169-hand range grid, hand codes, Chen-formula ranking
    rangeNotation.js       Standard range shorthand parse/format ('22+', 'A5s+')
    rangeEquity.js         Range-vs-hand / range-vs-range sampled equity
    rng.js                 Seedable PRNG (mulberry32)
    validation.js          Request validation, shared by client and server
  shared/tournament/     Pure tournament domain — same isomorphic rule
    blindStructure.js      Suggested blind schedule + clock math
    stats.js               Chip counts, average stack, prize pool
    payouts.js             Payout suggestions + exact-sum calculation
    validation.js          Request validation, shared by client and server
  shared/handLog/        Pure hand-log domain — same isomorphic rule
    positions.js           Position labels + acting order, derived from the button
    actions.js             Forced bets, pot maths, per-street betting state
    replay.js              Frame-by-frame replay of a logged hand
    analysis.js            Winners, showdown naming, all-in run-out equity
    validation.js          Request validation, shared by client and server
  server/
    app.js                 Express assembly (exported as a factory)
    server.js              Process lifecycle: bind, log, graceful shutdown
    config.js              All environment resolution, in one place
    routes/                Thin HTTP handlers built by dependency-taking factories
    services/              Orchestration between domain and store
    store/                 DataStore → JsonFileStore → {History,Tournament,HandLog}Repository
    middleware/            Error handling, async wrapper
    errors/                ApiError
public/                  Buildless frontend
  stylesheets/style.css   Design tokens (:root variables) + shared + per-page styles
  javascripts/poker/
    main.js                Bootstrap
    router.js              Minimal path-based client router (no dependency)
    AppShell.js             Page shell: nav + route switch
    pages/                  One component per route (OddsCalculator, RangeExplorer, TournamentManager, HandLogger, HandDetail)
    components/             Presentational components, shared across pages (CardSlot, RangeGrid, PokerTable, HandReplay, ...)
    hooks/                  Stateful logic (useHistory)
    services/               apiClient.js (all network access), handOwnership.js
test/
  shared/                Domain tests (shared/tournament/ mirrors src/shared/tournament/)
  server/                Store and end-to-end API tests
data/                    JSON store (contents gitignored)
```

### One domain, two runtimes

All of `src/shared/` is mounted at `/shared/`, so the browser imports the exact
same modules the API runs — the poker engine, the tournament clock, and the
hand-log replay alike:

```js
// server
import { calculateEquity } from '../../shared/poker/index.js';

// browser
import { SUIT_META } from '/shared/poker/cards.js';
import { buildReplayFrames } from '/shared/handLog/index.js';
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
`HistoryRepository`, `TournamentRepository` and `HandLogRepository` each expose a
domain-level API on top of the same store class. Services depend on the repository, so moving
to SQLite or Postgres means one new class and one changed line.

The file store is small but not naive — it guards against torn writes (temp file
plus atomic rename), interleaved writes (a serialised flush chain), concurrent
initialisation, and corrupt files on load (quarantined rather than fatal). It
also supports a read-modify-write `update(id, updater)` — history records are
immutable once written, but a tournament's roster and clock change
constantly, which is what that method is for.

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

### `POST /api/ranges/equity`

```json
{
  "heroRange": ["AA", "AKs"],
  "villain": { "cards": ["Kd", "Kc"] },
  "board": [],
  "iterations": 20000,
  "seed": "optional-for-reproducibility"
}
```

`villain` is either `{ "cards": [c1, c2] }` (a specific hand) or
`{ "hands": ["KK", "QQ"] }` (a range, same hand-code shorthand as `heroRange`).

```json
{
  "hero": { "win": 0.8534, "tie": 0.0021, "equity": 0.8545, "wins": 17068, "ties": 42, "comboCount": 16 },
  "villain": { "win": 0.1445, "tie": 0.0021, "equity": 0.1455, "wins": 2890, "ties": 42, "comboCount": 1 },
  "board": [],
  "method": "sampled",
  "iterations": 20000,
  "seed": 1234567890,
  "durationMs": 61
}
```

Unlike `/api/equity`, `method` is always `"sampled"` — there is no board-only
case small enough to enumerate exactly once a range is involved — and no
history record is created.

### Tournaments

```
POST   /api/tournaments                           create
GET    /api/tournaments                           list (lightweight summaries)
GET    /api/tournaments/:id                       full record + derived clock/stats/payouts
PATCH  /api/tournaments/:id                       update settings (setup only, see below)
DELETE /api/tournaments/:id                       delete
POST   /api/tournaments/:id/reset                 back to setup; roster and settings kept
PATCH  /api/tournaments/:id/registration          {action: 'close'|'reopen'}
POST   /api/tournaments/:id/players               register a player
DELETE /api/tournaments/:id/players/:playerId     remove a registration (setup only)
PATCH  /api/tournaments/:id/players/:playerId     {action: 'rebuy'|'addon'|'eliminate'|'reinstate'}
PATCH  /api/tournaments/:id/clock                 {action: 'start'|'pause'|'resume'|'advance'|'setLevel', levelIndex?}
```

Registration is its own piece of state, deliberately **not** inferred from
`status`: real tournaments keep late registration open after the clock has
started, so "has the tournament begun" and "can people still buy in" are
different questions. Closing registration is also what unlocks finalising the
payout split against the field's actual final size — a payout-split-only
`PATCH` is accepted after the start once registration is closed, which is the
one exception to settings being setup-only.

`GET /api/tournaments/:id` decorates the stored record with `derived`,
computed fresh on every read from `shared/tournament/`:

```json
{
  "derived": {
    "clock": { "levelIndex": 2, "level": { "smallBlind": 75, "bigBlind": 150, "ante": 75, "durationMinutes": 15 }, "remainingMs": 421000, "isFinalLevel": false },
    "totalChipsInPlay": 60000,
    "activePlayerCount": 5,
    "averageStack": 12000,
    "prizePool": 120,
    "payouts": [{ "place": 1, "percent": 50, "amount": 60 }, { "place": 2, "percent": 30, "amount": 36 }, { "place": 3, "percent": 20, "amount": 24 }]
  }
}
```

Eliminating players down to one active entrant auto-completes the tournament
and assigns first place; there's no separate "end tournament" step for the
common case. Completion also force-closes registration, so nobody can register
into an event that has already paid out — `POST /api/tournaments/:id/reset`
reopens it and returns the tournament to `setup` while keeping the roster and
settings, which is "run the same event again with the same players".

### Hands

```
POST   /api/hands           save a logged hand
GET    /api/hands           list saved hands (lightweight summaries)
GET    /api/hands/:id       full record + derived positions/pot/payouts
PATCH  /api/hands/:id       edit; merged over the stored record, then validated in full
DELETE /api/hands/:id       delete
```

A hand is a `name`, a table (`seats`, `buttonSeat`, `format`), four streets each
with a `board`, `actions` and `notes`, and a `result` holding the user's own
takeaway:

```json
{
  "name": "AK into the big stack",
  "format": {
    "gameType": "cash",
    "smallBlind": 50, "bigBlind": 100, "ante": 0,
    "straddleSeat": null, "straddleAmount": 0
  },
  "buttonSeat": 0,
  "seats": [
    { "name": "Hero",    "stack": 12000, "cards": ["As", "Kd"], "isHero": true },
    { "name": "Villain", "stack": 9400,  "cards": ["Qh", "Qc"], "isHero": false }
  ],
  "streets": {
    "preflop": { "board": [], "actions": [{ "seatNumber": 0, "type": "raise", "amount": 300 }], "notes": "" },
    "flop":    { "board": ["2c", "7d", "9h"], "actions": [], "notes": "" },
    "turn":    { "board": [], "actions": [], "notes": "" },
    "river":   { "board": [], "actions": [], "notes": "" }
  },
  "result": { "notes": "Should have three-bet bigger preflop." }
}
```

Seats are identified by **position in the array**: `seatNumber` is assigned from
the index, so you don't send it on a seat but you do reference it from an action,
and `buttonSeat` is that same zero-based index. A hand needs between 2 and 10
seats, and exactly one must be marked `isHero`. Action `type` is one of `fold`,
`check`, `call`, `bet`, `raise`; the last three carry an `amount`.

`action.amount` is **the total that seat has committed on that street once the
action is done** — "raise to 300", not "put in 300 more". Forced bets are never
listed: antes, blinds and the straddle are derived from `format` and
`buttonSeat` on read, so `actions` holds only voluntary decisions. `GET
/api/hands/:id` decorates the record with `derived`, holding the position
labels, the pot progression and the payouts, all computed fresh from
`shared/handLog/`.

Board cards are sent as fixed-size arrays with `null` holes while a hand is
being edited; the nulls are stripped on save, which is also what rejects a
half-dealt street.

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

391 tests via Node's built-in runner — no Jest, Mocha, or Chai.

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

- [x] Odds calculator with exact enumeration and seeded Monte Carlo
- [x] Persistent calculation history with replay
- [x] Exact outs (heads-up, incomplete board)
- [x] Range explorer — range-vs-hand and range-vs-range equity via sampling
- [x] Range notation import/export and a Chen-formula "top X%" slider
- [x] Tournament manager — registration, buy-ins/rebuys/add-ons, a live blind clock, payouts
- [x] Hand logger — recreate a hand, log the betting, replay it from a shared link
- [x] Live equity on an all-in run-out, priced by the calculator's own engine
- [ ] **Hand simulator** — deal and play out configurable spots from a seeded deck
- [ ] **Session tracker** — aggregate stored results into trends over time
- [ ] Tournament seating/table balancing
- [ ] CI pipeline (GitHub Actions) with test runs and build artifacts
- [ ] Hand-log extras — equity at every decision, replayer autoplay, hand-history import
- [ ] Database-backed store

## Notes

The CDN currently serves React's **development** builds, which are larger and
slower. Switch to `react.production.min.js` in
[public/index.html](public/index.html) before any real deployment.
