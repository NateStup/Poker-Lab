# CLAUDE.md

Guidance for working in this repository.

## What this project is

**Poker Lab** — a client/server poker toolkit. It exists as a portfolio piece, so
the code is meant to be *read*: clarity, structure, and comments that explain
reasoning matter as much as behaviour.

Shipped: a Texas Hold'em odds calculator with persistent history and exact
outs, a range explorer (range-vs-hand and range-vs-range equity, range
notation import/export, a Chen-formula "top X%" slider), and a tournament
manager (registration, buy-ins/rebuys/add-ons, a blind clock, and payouts).
Next up: a session tracker (see [Roadmap](#roadmap)).

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

## Git workflow

**Never commit or push directly to `main`.** Every change, including small
fixes, goes through a feature branch and a pull request:

```bash
git checkout -b <descriptive-branch-name>
# commit your changes
git push -u origin <descriptive-branch-name>
gh pr create
```

`main` is not currently protected server-side — the repo is private on GitHub's
free plan, which blocks branch protection / rulesets unless the repo is public
or on GitHub Pro. This is a workflow discipline to follow regardless. If the
repo later goes public or upgrades, apply:

```bash
gh api --method PUT repos/NateStup/myExpressApp/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks=null' \
  -F 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'required_pull_request_reviews[dismiss_stale_reviews]=false' \
  -f 'restrictions=null'
```

## Architecture

```
src/
  shared/poker/       Pure poker domain logic. Isomorphic — runs in Node AND the browser.
  shared/tournament/  Pure tournament domain logic (blind clock, stats, payouts). Same rules.
  server/             Express app: config, routes, services, store, middleware.
public/               Static frontend. Buildless native ES modules + CDN React.
test/shared/          Domain tests (test/shared/tournament/ mirrors src/shared/tournament/).
test/server/          Store and end-to-end API tests.
data/                 JSON data store (contents gitignored).
```

Request flow: `route → service → domain` on the way in, `→ store` on the way out.

### The one rule that shapes everything: shared domain code

`src/shared/` (both `poker/` and `tournament/`) is served to the browser at
`/shared/` (see the static mount in [src/server/app.js](src/server/app.js)).
Server code imports it by relative path; client code imports it as
`/shared/poker/cards.js` or `/shared/tournament/index.js`. **One
implementation, two consumers.** The tournament clock is the clearest example
of why this matters: `computeClockState` runs identically on the server (to
produce `derived.clock` in an API response) and in the browser (to tick the
countdown once a second between syncs) — there is no second implementation
to drift out of sync with the first.

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
| Domain | `src/shared/poker/`, `src/shared/tournament/` | Pure functions and classes. No I/O. Fully unit-testable. |
| Service | `src/server/services/` | Orchestrates domain + store. Takes dependencies via constructor injection. |
| Route | `src/server/routes/` | Thin: parse, delegate, respond. Built by a `createXRouter({deps})` factory so tests can inject stubs. |
| Store | `src/server/store/` | Persistence behind the `DataStore` interface. |

`createApp({historyRepository, tournamentRepository})` accepts injected
repositories — that is how the API tests run against temp directories instead
of real data.

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

A **hand code** (`ranges.js`) is the 169-way shorthand for a class of starting
hands: `'AA'` (pair), `'AKs'` (suited), `'AKo'` (offsuit) — always high rank
first; `parseHandCode` rejects `'KAs'` rather than silently correcting it.
`RANGE_GRID` is the 13x13 layout the UI renders directly: diagonal = pairs,
above it = suited, below it = offsuit. `expandRangeToCombos` turns a list of
hand codes into concrete two-card hands, deduplicated and with any combo that
touches a blocked card removed.

`calculateRangeEquity` (`rangeEquity.js`) is deliberately **not** "call
`calculateEquity` once per combo pairing" — for two wide ranges that's well
over a million pairings before a board card is even dealt. Instead it samples
the whole spot directly each iteration (draw one combo from each side, deal
the rest of the board, score), so cost stays roughly constant regardless of
range width. Because of that there is no board-only case small enough to
enumerate exactly once a range is involved — `method` is always `'sampled'`,
unlike `calculateEquity`.

`chenScore` (`ranges.js`) is the classic Chen Formula — a deterministic,
by-hand hand-strength heuristic, not a simulation — used to rank all 169
hands (`HAND_STRENGTH_ORDER`) for two UI features: the range grid's baseline
heat-map tint (`HAND_TIER`, computed once at module load since the ranking
never changes) and the "top X%" range slider (`selectTopPercent`, which adds
whole hand classes off that ranking until the target combo count is reached
— it never selects a partial class). If this ever needs to become equity-based
instead of heuristic, `HAND_STRENGTH_ORDER` is the one thing to replace; both
consumers read through it rather than recomputing anything themselves.

`calculateOuts` (`outs.js`) is exact, not sampled — at most 46 unseen cards
on a flop, so every one is just dealt and evaluated rather than estimated.
Deliberately scoped to two players with an incomplete board: with three or
more players a card can help one opponent while hurting another, so there is
no single meaningful "outs" count per player without first picking which
opponents it must beat — exactly the ambiguity `calculateEquity`'s sampling
sidesteps by reporting a probability instead.

`parseRangeString`/`formatRangeString` (`rangeNotation.js`) round-trip the
standard shorthand every range tool uses (`'22+'`, `'A5s+'`, `'77-TT'`).
`formatRangeString` groups each "family" (all pairs; one top card's suited
hands; one top card's offsuit hands) strongest-to-weakest and only ever emits
`+` when a run reaches the strongest hand in its family — that's the actual
meaning of `+`, not just "some hands compressed."

## Tournament domain (`src/shared/tournament/`)

A tournament never has a live chip count typed in for any player — that
would be exactly the manual bookkeeping this feature exists to remove.
Instead every number derives from two kinds of event: an **entry** (buy-in,
rebuy, or add-on, each worth a fixed chip amount and dollar amount) and an
**elimination**. `totalChipsInPlay`/`prizePool` are sums over entries;
`averageStack` is total chips divided by players still in (`stats.js`).

`generateBlindStructure` produces a suggested schedule off a fixed "nice
chip denominations" ladder — a starting point the organizer is expected to
edit, not a solved schedule. `computeClockState` (`blindStructure.js`) is the
pure function both the server (`derived.clock` in an API response) and the
browser (the ticking countdown) call with the same inputs; it takes the raw
clock record and a timestamp and has no side effects, which is what makes it
identical in both places. A finishing place is assigned by counting down from
the entrant count on each elimination (`TournamentRepository.eliminatePlayer`
in `src/server/store/`) — once exactly one player remains, they're
place 1 and the tournament auto-completes; no separate "end tournament" step
for the common case.

`calculatePayouts` (`payouts.js`) rounds each place independently and folds
the entire rounding remainder into first place, so payouts always sum to
exactly the prize pool and only one place's number is ever adjusted for it.
`suggestPaidPlaces` maps field size to place count off a fixed breakpoint
table tuned for home-game sizes (2 pays 1, 5 pays 2, 9 pays 3, ...) rather
than a continuous formula — a "top 12.5%" curve doesn't cross the rounding
threshold to suggest a 2nd place until the field reaches about a dozen
entrants, which is a bad default for the small fields this app targets.

A tournament's `payoutSplit` tracks the field size automatically —
`TournamentRepository.registerPlayer`/`removePlayer` recompute it via
`suggestPaidPlaces`/`suggestPayoutSplit` on every roster change — until the
organizer explicitly sets one (via `PATCH .../:id` or the paid-places
stepper in `TournamentPayouts`), which flips the persisted
`payoutSplitCustomized` flag and stops the auto-adjustment for good. Without
that flag, a split chosen before the roster filled out would otherwise get
silently overwritten by the next registration.

`TournamentRepository.resetProgress` (`POST /api/tournaments/:id/reset`)
returns a tournament to `setup` — clock to level 0, every player's
eliminations/rebuys/add-ons cleared — while keeping the roster and settings
(including a customized payout split) untouched. This is "run the same
event again with the same players," not "start over from an empty room";
it works from any status, and afterwards the existing `start` clock action
serves as the restart.

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

`DataStore#update(id, updater)` is a read-modify-write: `HistoryRepository`
never needed it (a calculation result is immutable once stored), but
`TournamentRepository` uses it for everything after creation — a tournament's
roster, clock, and blind level all change constantly. The read, `updater`
call, and write into the in-memory array happen synchronously in one tick
(only the disk `flush()` after is async), so two `update()` calls on the same
id can't interleave and silently lose one's change.

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

Client structure: `main.js` (bootstrap) → `AppShell.js` (page shell: nav +
route switch) → `pages/` (one component per route, owns that page's state) →
`components/` (presentational) + `hooks/` (stateful logic) + `services/`
(API access). All fetch calls go through `services/apiClient.js`, which
normalises the server's `{error: {message, details}}` shape into thrown
`ApiRequestError`s — components only ever handle exceptions.

**Routing.** Three routes (`/` → Odds Calculator, `/ranges` → Range Explorer,
`/tournament` → Tournament Manager) didn't justify a router dependency, so
`router.js` is a ~50-line hand-rolled one: a `useRoute()` hook backed by
`history.pushState`/`popstate`, and a `Link` component that intercepts a
plain left click. This is what "minimise dependencies" (see Conventions)
looks like in practice — reach for a library when the hand-written version
stops being trivial, not before.

**Shared look and feel.** `public/stylesheets/style.css` opens with a `:root`
block of design tokens (color, spacing, radii, shadows) that every page's
classes are built from. Adding a page means composing `.hero-card` /
`.result-card` / `.ghost-button` and friends with those variables, not
inventing a new palette — that's what keeps two unrelated features (an odds
calculator, a range grid) looking like one product.

**Card selection: `CardSlot`.** Every individual card position on both pages
(a player's hole card, a board street's card, the villain's hand) is its own
`CardSlot` — a card back until clicked, then a `CardPicker` popover scoped to
just that one position. State is modeled as fixed-size arrays with `null`
holes (`players[i]` is always `[card|null, card|null]`), never a
variable-length array built by pushing cards in pick order — that's what lets
each position be independently addressable instead of the whole hand sharing
one shared picker underneath it. Only one popover is open at a time, tracked
as a single `openSlot` id at the page level; opening a new one implicitly
closes whatever was open. The popover is `position: absolute` and doesn't
reserve layout space, so an open picker renders a full-viewport
`.card-picker-backdrop` behind it (dismissable by click, same as the
existing outside-click handler) — without it, a picker taller than the room
below its slot visually overlapped nearby buttons and text instead of
reading as a layer on top of them.

**The tournament clock's tick vs. sync split.** `TournamentManagerPage` does
not poll once a second to animate the countdown — it re-renders once a
second (a `setInterval` that only increments a counter) and recomputes
`computeClockState` locally from the server's raw `levelStartedAt`/
`pausedElapsedMs` each time, which is why the countdown is smooth with zero
extra network traffic. A separate, slower interval (every few seconds)
re-fetches the tournament to catch changes made from another device. When
the locally-computed countdown reaches zero, this page calls the advance
action once (guarded by a ref so a fast series of re-renders can't double-fire)
— there is no server-side cron doing it, so a tournament nobody has open just
waits at `0:00` rather than silently skipping levels in the background.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/equity` | Calculate equity; records history |
| `POST` | `/api/ranges/equity` | Range-vs-hand or range-vs-range equity; not recorded to history |
| `GET` | `/api/history` | Page of records, newest first (`limit`, `offset`, `type`) |
| `GET` | `/api/history/stats` | Aggregate counts |
| `GET` | `/api/history/:id` | Single record |
| `DELETE` | `/api/history/:id` | Delete one |
| `DELETE` | `/api/history` | Clear all |
| `POST` | `/api/tournaments` | Create a tournament |
| `GET` | `/api/tournaments` | List tournaments (lightweight summaries) |
| `GET` | `/api/tournaments/:id` | Full record, decorated with `derived` (clock, stats, payouts) |
| `PATCH` | `/api/tournaments/:id` | Update settings; only while `status === 'setup'` |
| `DELETE` | `/api/tournaments/:id` | Delete a tournament |
| `POST` | `/api/tournaments/:id/reset` | Reset to `setup`: clock to level 0, player progress cleared, roster and settings kept |
| `POST` | `/api/tournaments/:id/players` | Register a player |
| `DELETE` | `/api/tournaments/:id/players/:playerId` | Remove a registration; only while `status === 'setup'` |
| `PATCH` | `/api/tournaments/:id/players/:playerId` | `{action: 'rebuy'\|'addon'\|'eliminate'\|'reinstate'}` |
| `PATCH` | `/api/tournaments/:id/clock` | `{action: 'start'\|'pause'\|'resume'\|'advance'\|'setLevel', levelIndex?}` |

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
4. **Tournament seating/table balancing** — the manager currently tracks
   registration, stacks, the clock, and payouts, but not seat assignments;
   a natural extension once multi-table events are in scope.

## Gotchas

- `data/` contents are gitignored; `data/.gitkeep` is tracked so the directory exists.
- Cards are case-normalised at the validation boundary (`normalizeCard`), so
  domain code can assume canonical form.
- `combinations()` **reuses its output array** for every yield — copy it if you
  need to retain it beyond the loop iteration.
- The equity engine credits split pots fractionally, so every player's equity
  sums to exactly 1. Don't "fix" this to whole-number win counts.
