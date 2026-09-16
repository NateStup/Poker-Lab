# Poker Lab

A client/server poker toolkit built on Node, Express, and React — a Texas
Hold'em odds calculator with persistent history and exact outs, a range
explorer for range-vs-hand and range-vs-range equity, a tournament manager
with a live blind clock and payouts, and a hand logger that replays a saved
hand action by action. Accounts are real: a saved hand belongs to whoever
logged it and is reachable by nobody else, unless its owner generates a
revocable link to share it read-only.

**Live at [pokerlab-ebon.vercel.app](https://pokerlab-ebon.vercel.app)** —
Vercel for the app, Postgres on Neon.

The emphasis throughout is on architecture that reads clearly on its own: a
pure domain layer shared verbatim between server and browser,
dependency-injected services, a data layer that's genuinely relational where
ownership needs enforcing and a swappable generic store where it doesn't, and
tests that assert on provable poker facts rather than on coincidence.

## Quick start

Only needed to run it yourself — the live link above already has it running.

```bash
npm install
npm start
# open http://localhost:3000
```

```bash
npm run dev    # auto-restart on change
npm test       # 496 tests, no test framework dependency
```

Requires **Node 20.11 or newer**. No build step — the frontend is served as
native ES modules.

### Running with Postgres

The store defaults to Postgres. Bring the database up, apply the schema, then
start the server as usual:

```bash
docker compose up -d postgres   # or: npm run db:up
cp .env.example .env            # credentials already match docker-compose.yml
npm run db:migrate              # creates history, tournaments, hands
npm start                       # or npm run dev
```

`npm run db:migrate` is safe to re-run — applied migrations are recorded by
filename, so a second run reports nothing to apply. It is deliberately not run
on boot: a schema change is a deploy step, not a side effect of starting the
app.

Postgres is required now, not optional — accounts, sessions, and hand
ownership are relational and have no honest JSON-file equivalent.
`STORE_DRIVER=json` still exists internally for `history` and `tournaments`,
but `npm start` builds every repository at boot, so setting it refuses to
start the app at all rather than running a quietly incomplete one. See
[CLAUDE.md](CLAUDE.md) for why that's a deliberate failure, not a bug.

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

Every calculation is written to a history panel that can reload a past spot
back into the form — scoped to whoever's logged in, or not listed anywhere
at all if nobody is. Running a calculation never requires an account; only
an account's own history is ever shown to it. Heads-up, with the board at 
the flop or the turn, the result also breaks down each player's **outs** — the 
exact unseen cards that make them the winner or a chop on the very next card, 
computed by enumeration rather than sampled.

**Range Explorer.** Paint a hero range on the standard 13x13 grid — by hand,
or with a "top X%" slider driven by the classic Chen Formula hand ranking —
choose an opponent (a specific hand or another range), and get equity for the
matchup. This always samples: averaging exact equities across every combo
pairing in two wide ranges is well over a million evaluations before a single
board card is dealt, so `calculateRangeEquity` instead draws one combo from
each side per iteration and deals the rest of the board, keeping the cost
roughly constant regardless of range width.

Every individual card position on both pages — a hole card, a board street's
card, the villain's hand — is shown face-down until clicked, at which point a
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
money in the pool, before anyone's even been eliminated. No account is needed
to create or run one, and creating one while logged in claims it immediately
— no separate step. Made anonymously, a tournament stays exactly as open as
before accounts existed: anyone with the link can view or run it, but it's
never listed anywhere, findable only by the browser that made it. A "Save"
button lets you claim it later if you log in partway through. Claimed either
way, a tournament becomes as private as a saved hand: reachable and editable
only by that account, gated on every verb including reads.

**Hand Logger.** Requires an account. Recreate a hand you played on a table
diagram — seats, stacks, who was on the button — then log the betting street
by street and write down what you were thinking. A saved hand is private to
the account that logged it, and replays action by action: each street dealt,
each bet pushed out in front of a seat and swept into the middle, each fold
greyed out, the pot settled at the end. Sharing is explicit and revocable —
generating a link hands out a read-only view with no login and no edit
access, and revoking it stops the link working without touching the hand
itself.

It is a logger, not a rules engine, and the line it holds is that impossible
*data* is rejected while merely odd *poker* is not. A turn dealt before a flop
or a card used twice is refused; betting after folding, a wild overbet, or a
call for less than the bet is accepted, because someone reconstructing a hand
from memory is far likelier than someone making a claim about the rules.

Two things are deliberately never typed in. **Forced bets are derived** — antes,
blinds and straddles come from the table format and the button, so the stored
action list holds only voluntary decisions. And there is **no winner picker**:
the winner is derived, not asked for — comparing hand rankings against what
got logged (the folds, the final board, the revealed holdings) using the
same evaluation logic the odds calculator itself uses, not just "whoever
didn't fold." When the cards genuinely don't say — a villain who mucked
unseen, a hand cut short — the pot shows as unawarded and the page asks for
the missing holding instead of guessing.

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
    auth/                  Password hashing (scrypt, self-describing hash format)
    routes/                Thin HTTP handlers built by dependency-taking factories
    services/              Orchestration between domain and store
    store/                 DataStore → {JsonFileStore, PostgresStore} → {History,Tournament}Repository,
                             plus HandLog/Users/SessionsRepository writing SQL directly
    middleware/            Error handling, async wrapper, session auth (required + optional)
    errors/                ApiError
public/                  Buildless frontend
  stylesheets/style.css   Design tokens (:root variables) + shared + per-page styles
  javascripts/poker/
    main.js                Bootstrap
    router.js              Minimal path-based client router (no dependency)
    AppShell.js             Page shell: nav + route switch, wraps everything in AuthProvider
    context/                AuthContext.js — who's logged in, shared across the app
    pages/                  One component per route (OddsCalculator, RangeExplorer,
                              TournamentManager, HandLogger, HandDetail, SharedHand, Auth)
    components/             Presentational components, shared across pages (CardSlot, RangeGrid, PokerTable, HandReplay, ...)
    hooks/                  Stateful logic (useHistory)
    services/               apiClient.js (all network access), tableTheme.js
test/
  shared/                Domain tests (shared/tournament/ mirrors src/shared/tournament/)
  server/                Store and end-to-end API tests
data/                    JSON store (contents gitignored; json driver only)
migrations/              Hand-written .sql schema changes (npm run db:migrate)
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
              repository → store → database    (history, tournaments)
              repository → database directly   (hands, users, sessions)
```

Routes are created by factories that receive their dependencies
(`createEquityRouter({equityService})`), and `createApp()` accepts injected
repositories. Auth routes are the one exception to the diagram above -- they
go straight from route to service to repository with no domain layer at all,
since password hashing needs `node:crypto` and could never run in the shared,
browser-safe domain code.

This is what lets most of the API test suite boot the real middleware stack
against a temp directory or a throwaway schema. The one documented exception
is `/api/hands`'s own tests, which run against the real tables -- see
"Testing" below for why, and what protects against that being unsafe.

### Data store

`DataStore` defines the contract; `JsonFileStore` implements it over JSON files
and `PostgresStore` over one table per collection. `HistoryRepository` and
`TournamentRepository` each expose a domain-level API on top of whichever of
the two they were handed -- services depend on the repository, never on a
concrete store, which is what made adding Postgres a new class and a branch in
one factory rather than a change anywhere upstream. `STORE_DRIVER` still picks
between them at boot for these two collections.

`HandLogRepository`, `UsersRepository`, and `SessionsRepository` don't go
through `DataStore` at all -- they write SQL directly against tables with real
columns and foreign keys (`hands.user_id`, `hands.share_token`, `users.email`,
`sessions.expires_at`), because ownership, credentials, and revocable sharing
are relationships a generic JSONB blob has no way to enforce. `hands` moved
here once accounts existed to give it something to reference; `users` and
`sessions` never had a JSON-file era at all. This is why `STORE_DRIVER=json`
no longer boots the app -- see "Quick start" above.

`history` and `tournaments` keep the original shape: `id`, `data JSONB`,
`created_at`, `updated_at`, a faithful translation of the JSON record rather
than a relational model, because neither has a relationship worth modelling.
The one interface change the Postgres swap needed for these two was
`list({where})`, which went from a JavaScript predicate to a plain equality
object -- a closure cannot become a `WHERE` clause. Schema changes are
hand-written `.sql` files in `migrations/`, applied by `npm run db:migrate`
and tracked in a `schema_migrations` table.

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
POST   /api/tournaments/:id/save                  claim an unowned tournament for the caller, permanently
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

No login is required to create or use a tournament -- every route runs under
`optionalAuth`, not `requireAuth`, except the two below. `POST
/api/tournaments` auto-claims the new tournament for the caller if a session
is present, the same way `POST /api/hands` always does; with no session,
it's created unowned. An unowned tournament stays exactly as open as before
accounts existed: anyone can read or mutate it. `POST /api/tournaments/:id/save`
is the second path to ownership -- claiming an unowned tournament for the
caller after the fact, permanently, with no unsave. However a tournament
comes to be owned, it's then gated on every verb, including reads, the same
rule hands already follow: a tournament that isn't yours reports 404, not a
different error, whether you're logged in as someone else or not logged in
at all.

`GET /api/tournaments` requires login and is unconditionally scoped to the
caller's own saved tournaments -- there's no "everyone's tournaments" view
and no `mine` flag, since there's no other mode to opt out of.

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

### History

```
GET    /api/history            the caller's own records, newest first (`limit`, `offset`, `type`)
GET    /api/history/stats      aggregate counts, scoped to the caller
GET    /api/history/:id        a single record
DELETE /api/history/:id        delete one record
DELETE /api/history            clear the caller's own records
```

`POST /api/equity` stamps a result with whoever's logged in, the same
auto-claim `POST /api/tournaments` uses -- there's no separate save step.
And unlike tournaments, this is permanent by design, not a gap left for
later: an anonymous calculation has no path to being claimed after the
fact. `POST /api/ranges/equity` never persists to history at all,
regardless of login -- there's no `RECORD_TYPES` entry for a range result.

`GET /api/history` and `/stats` require login and are unconditionally
scoped -- there's no anonymous "everyone's history" view. A single record
follows tournaments' accessibility rule exactly: unowned is open to anyone
with its id, owned is readable and deletable only by its owner, 404 for
everyone else. `DELETE /api/history` clears only the caller's own records
-- anonymous and other accounts' records are untouched.

### Hands

Every route below requires a session -- there is no anonymous hand logging.
A hand's `id` is private to the account that created it; every verb reports
`404`, not `403`, for a hand that exists but isn't the caller's, since
confirming "this exists, you just can't touch it" would be its own leak.

```
POST   /api/hands              save a logged hand
GET    /api/hands              list the caller's own saved hands (lightweight summaries)
GET    /api/hands/:id          full record + derived positions/pot/payouts (owner only)
PATCH  /api/hands/:id          edit; merged over the stored record, then validated in full
DELETE /api/hands/:id          delete
POST   /api/hands/:id/share    issue (or replace) a read-only share token
DELETE /api/hands/:id/share    revoke the share token, leaving the hand itself untouched
```

```
GET    /api/shared-hands/:token   the public, read-only view -- no session required
```

This last route is deliberately its own router, mounted at its own path, not
a conditionally-unauthenticated branch of the router above -- so a future
route landing in `handLogRoutes.js` can never inherit public access by
accident. Sharing is a second identifier, not a permission on the first: a
hand's own `id` never becomes reachable by anyone but its owner, however it's
shared.

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
action is done** — "raise to 300". Forced bets are never
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
| `POST` | `/api/auth/signup` | Create an account and start a session |
| `POST` | `/api/auth/login` | Start a session |
| `POST` | `/api/auth/logout` | End the current session |
| `GET` | `/api/auth/me` | The logged-in user, if any |

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

496 tests via Node's built-in runner — no outside testing framework at all.
Eight suites are Postgres-only (`/api/hands` and its cleanup check, `/api/history
ownership`, `/api/tournaments ownership` and its cleanup check,
`HandLogRepository`, `PostgresStore`, and `PostgresStore` durability) and
skip themselves with a reason when no database is reachable, so the full
suite still passes without Docker running -- at 430 instead of 496.

Security-critical policy -- ownership scoping, and the identical error for a
wrong password versus an unknown email -- is also asserted directly against
`AuthService` and `HandLogService`, using in-memory fakes of their
repositories rather than a real database. That coverage runs every time,
regardless of Docker, precisely because the Postgres-backed suites above
don't.

`/api/hands`'s own tests are the one place still worth a caveat: they run
against the real `hands`/`users`/`sessions` tables rather than a temp
directory or a throwaway schema, since none of the three repositories behind
them expose a table-name override the way `PostgresStore` does for
`history`/`tournaments`. Each test creates its own account with a random
email, touches only its own rows, and a dedicated cleanup suite asserts the
three tables are back to their pre-suite counts afterward.

The `/api/history ownership` and `/api/tournaments ownership` blocks need a
live database for the same reason -- testing who owns a record means signing
up real accounts -- but `history` and `tournaments` records themselves stay
behind the temp-directory `JsonFileStore` the rest of those two suites use,
not a real table, so there's nothing there for a cleanup check to count.
Each block's own `after` hook deletes exactly the `users` rows it created;
`/api/tournaments ownership` additionally has a dedicated cleanup suite
asserting `users`/`sessions`/`hands` are back to their pre-suite counts,
matching `/api/hands`'s own pattern.

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
`fetch`; most store tests run against `fs.mkdtemp` directories or a throwaway
Postgres schema and never touch real data.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Controls error verbosity and log format |
| `DATA_DIR` | `./data` | Where the JSON store lives (`json` driver only) |
| `STORE_DRIVER` | `postgres` | `postgres` or `json` -- see "Quick start" for why `json` no longer boots the app |
| `DATABASE_URL` | `postgres://pokerlab:pokerlab_dev@localhost:5432/pokerlab` | Connection string |
| `SESSION_SECRET` | a dev-only literal | Signs the session cookie; **the server refuses to boot without a real value in production** |
| `SESSION_TTL_MS` | 30 days, in ms | How long a session lasts before logging in again is required |
| `MAX_HISTORY_RECORDS` | `500` | Retention cap; oldest evicted first |
| `WRITE_DEBOUNCE_MS` | `50` | How long `JsonFileStore` batches writes before flushing to disk |
| `LOG_FORMAT` | `dev` / `combined` | morgan format |

## Tech stack

**Backend** — Node 20+, Express 4, ES modules throughout.
**Frontend** — React 18 (UMD via CDN), native ES modules, no build step.
**Data** — Postgres, required. `history` and `tournaments` sit behind one
swappable interface (a JSON file store or Postgres); accounts, sessions, and
hands are Postgres-only, with real columns and foreign keys where ownership
needs enforcing.
**Testing** — `node:test` and `node:assert`.

Dependencies are kept deliberately minimal: four runtime packages
(`express`, `morgan`, `cookie-parser`, `pg`) and zero dev dependencies — no
ORM and no query builder; the store writes its own SQL, and passwords are
hashed with Node's own `crypto.scrypt` rather than pulling in `bcrypt`. The
frontend uses `React.createElement` rather than JSX so it runs in the browser
untouched; see [CLAUDE.md](CLAUDE.md) for when that tradeoff should be
revisited.

## Roadmap

- [x] Odds calculator with exact enumeration and seeded Monte Carlo
- [x] Persistent calculation history with replay
- [x] Exact outs (heads-up, incomplete board)
- [x] Range explorer — range-vs-hand and range-vs-range equity via sampling
- [x] Range notation import/export and a Chen-formula "top X%" slider
- [x] Tournament manager — registration, buy-ins/rebuys/add-ons, a live blind clock, payouts
- [x] Hand logger — recreate a hand, log the betting, replay it action by action
- [x] Live equity on an all-in run-out, priced by the calculator's own engine
- [x] Database-backed store — Postgres behind the same `DataStore` interface
- [x] Accounts — signup/login/logout, signed session cookies, `scrypt` password hashing
- [x] Hand ownership and revocable sharing — a hand is private by default; a
      share token, not the hand's own id, is what anyone else can see
- [x] Tournament save/claim — anonymous by default, private and unlisted
      once saved, with no unsave
- [x] Calculation history scoped to accounts — recorded regardless of
      login, but only ever shown to its owner
- [x] Deployed — Vercel, Postgres on Neon

## Notes

Deployed and live at [pokerlab-ebon.vercel.app](https://pokerlab-ebon.vercel.app)
— Vercel for the app, Neon for Postgres, and the CDN in
[public/index.html](public/index.html) serving React's production build.

The one genuinely surprising part of getting there: Vercel's zero-config
Express detection does a literal static check for `import express from
'express'` in the entry file — confirmed by its own build error, "No
entrypoint found which imports express," after two technically-correct
entry points were each silently never built into a function at all. The
fix was one otherwise-unused import line, kept deliberately in
[server.js](server.js) with a comment explaining why it's there —
removing it breaks detection again with no runtime error, only a build
that quietly stops producing a function.
