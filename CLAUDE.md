# CLAUDE.md

Guidance for working in this repository.

## What this project is

**Poker Lab** — a client/server poker toolkit. It exists as a portfolio piece, so
the code is meant to be *read*: clarity, structure, and comments that explain
reasoning matter as much as behaviour.

Shipped: a Texas Hold'em odds calculator with persistent history and exact
outs, a range explorer (range-vs-hand and range-vs-range equity, range
notation import/export, a Chen-formula "top X%" slider), a tournament
manager (registration, buy-ins/rebuys/add-ons, a blind clock, and payouts),
and a hand logger (recreate a hand on a table diagram, log the betting and
your thinking street by street, then share a link that replays it action by
action).
Next up: a poker simulator (see [Roadmap](#roadmap)).

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
  shared/handLog/     Pure hand-log domain logic (positions, forced bets, pot maths, replay, analysis). Same rules.
  server/             Express app: config, routes, services, store, middleware.
public/               Static frontend. Buildless native ES modules + CDN React.
test/shared/          Domain tests (test/shared/tournament/ mirrors src/shared/tournament/).
test/server/          Store and end-to-end API tests.
test/client/          Tests for pure frontend modules (no DOM, no React).
data/                 JSON data store (contents gitignored).
```

Request flow: `route → service → domain` on the way in, `→ store` on the way out.

### The one rule that shapes everything: shared domain code

`src/shared/` (`poker/`, `tournament/` and `handLog/`) is served to the browser
at `/shared/` (see the static mount in [src/server/app.js](src/server/app.js)).
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
- One shared module may import another — `handLog/` reads card helpers and the
  table-size bounds out of `poker/`. That's fine; both are pure, and the
  alternative is a second `normalizeCard` to keep in sync, which is the exact
  split this directory exists to prevent.

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
`suggestPaidPlaces` is deliberately two rules joined at a seam. Small fields
come off a hand-tuned breakpoint table (2 pays 1, 5 pays 2, 9 pays 3, up to
39 pays 6), because a percentage rule alone doesn't cross the rounding
threshold to pay a 2nd place until about a dozen entrants — a bad default for
the home games this app targets. Above the table it pays the standard **top
15% of the field**, so the suggestion keeps growing with a real field (100
entrants pay 15, 1000 pay 150) instead of stalling. The table's last row is
positioned so the two rules meet without a step, and there is a test
asserting the suggestion never shrinks as the field grows.

`suggestPayoutSplit` hand-writes the curve up to `MAX_TABULATED_PLACES` (9),
where published structures agree closely, and generates it beyond — each
place's share proportional to `1 / place^0.9`, normalised to 100. The
exponent is the one tuning knob: a plain harmonic curve (exponent 1) is a
shade too top-heavy against real structures, and 0.9 lands on them (15 paid
places gives first ~27% and a min-cash ~2.3%). Two-decimal rounding flattens
the deep tail into tiers of places paying the same percentage — that matches
published structures, and is not a defect to smooth out.

`maxPaidPlaces(entryCount)` is what bounds the UI's paid-places stepper. It
is the field size, not a constant: you cannot pay more places than you have
entrants, and the old fixed ceiling of 6 was the reason a large tournament
could not be given a realistic structure at all.

A tournament's `payoutSplit` tracks the field size automatically —
`TournamentRepository.registerPlayer`/`removePlayer` recompute it via
`suggestPaidPlaces`/`suggestPayoutSplit` on every roster change — until the
organizer explicitly sets one (via `PATCH .../:id` or the paid-places
stepper in `TournamentPayouts`), which flips the persisted
`payoutSplitCustomized` flag and stops the auto-adjustment for good. Without
that flag, a split chosen before the roster filled out would otherwise get
silently overwritten by the next registration.

A tournament's **status is never shown as just its `status` field**. "Active"
answers nothing anyone asks of a list row or a header — the question is always
what level it is on and what the blinds are, so `TournamentStatus` renders
"Level 4 · 200/400 (ante 50)" with the bare state (not started, paused,
complete) as the qualifier rather than the headline. The list needs level data
to do that, which is why `#summarize` runs `computeClockState` and carries
`currentLevel`/`clockStatus`/`isFinalLevel` — still a summary, not the whole
structure. The open tournament's header reads the *live* clock, so its level
rolls over with the countdown instead of at the next resync.

Registration is its own piece of state (`registrationOpen`), deliberately
**not** inferred from `status`: real tournaments keep late registration open
after the clock has started, so "has the tournament begun" and "can people
still buy in" are different questions. Closing registration is what unlocks
finalizing the payout split against the field's actual final size — a
payout-split-only `PATCH` is accepted post-start once registration is
closed, which is the one exception to the settings-are-setup-only rule.
Completion force-closes registration (`eliminatePlayer`), so nobody can
register into an event that has already paid out; `resetProgress` reopens it.

`TournamentRepository.resetProgress` (`POST /api/tournaments/:id/reset`)
returns a tournament to `setup` — clock to level 0, every player's
eliminations/rebuys/add-ons cleared — while keeping the roster and settings
(including a customized payout split) untouched. This is "run the same
event again with the same players," not "start over from an empty room";
it works from any status, and afterwards the existing `start` clock action
serves as the restart.

## Hand-log domain (`src/shared/handLog/`)

A logged hand is a table (`seats`, `buttonSeat`, `format`), four streets
(each with `board`, `actions`, `notes`), and a `result` that is now just the
user's own notes. It is a **logger, not a rules engine** — the line it holds
is that impossible *data* is rejected while merely odd *poker* is not. A turn
dealt before a flop, a card used twice, a hand with no hero: rejected. Betting
after folding, a wild overbet, a call for less than the bet: accepted, because
someone reconstructing a hand from memory is far likelier than someone
making a claim about the rules. Deliberately out of scope: min-raise and
turn-order legality, and side pots.

**Who won used to be out of scope too, and no longer is.** The hand records
the folds, the board and the holdings — everything the question needs — so
asking for the winner on top of that was asking for the same fact twice, with
nothing keeping the two answers in agreement. `determineWinners` reads it off
the hand instead, and `result.winningSeats` is gone from the record (a payload
that still carries one is accepted and ignored, so hands saved before the
change still load). The objection that motivated the old design is real and is
handled by admitting it: when the cards genuinely don't say — a villain who
mucked unseen, a hand cut short before the river — nothing is returned, the
pot shows as unawarded, and the UI asks for the missing holding rather than
guessing.

The one convention that makes the pot come out right: **`action.amount` is
the total that seat has committed on that street once the action is done**
— "raise to 300", not "put in 300 more". That is how poker is spoken, and
it makes blinds fall out for free: a big blind calling a raise to 300 logs
`call 300`, and `computeHandDerived` subtracts the 100 already posted
rather than double-counting it.

`commitIncrement` is the single place that turns one of those totals into
chips, and it clamps in **both** directions. Below what the seat already has
out is clamped to zero, so a mistyped log can't pull chips back out of the
pot. Above what the seat has left is clamped to the stack, because a player
cannot bet chips they don't have: "raise to 5000" with 600 behind is an
all-in for 600. Forced bets go through it too — a stack too short to cover
the blind posts what it has. Before that clamp existed, either case produced
a **negative stack**, which then rode along through the whole replay as a seat
playing on with less than nothing. Every walk over the action list
(`computeHandDerived`, `buildReplayFrames`, `streetBettingState`) goes through
this one function, which is what stops the three of them disagreeing about
what an action cost.

Note what is *not* clamped: `deriveForcedBets` still reports the blind that
was owed, not the short stack that was posted. It describes the obligation;
the arithmetic decides what was payable.

`streetBettingState(hand, street, actionCount)` answers "what does the seat
about to act face" — per-seat committed, stacks, folds, all-ins, the highest
bet, and the pot, optionally partway through a street. `nextToAct` picks the
seat the editor should offer next, walking `actingOrder` (`positions.js`,
where heads-up inverts: the button acts first preflop and last after it) and
skipping seats that are folded or all in. Both exist for the editor and both
are **suggestions** — nothing here enforces turn order, because a hand
reconstructed from memory usually records only the actions that mattered.

Forced bets are **derived, never logged**: `deriveForcedBets` computes
antes/blinds/straddle from `format` + `buttonSeat`, so the stored `actions`
list holds only voluntary decisions. Typing "SB posts 50, BB posts 100, and
nine antes of 25" is exactly the bookkeeping this feature exists to remove.

`derivePositions` (`positions.js`) is the single source of position labels;
they are computed from `buttonSeat`, never stored per seat, so an edit to
the button can't leave stale labels behind. Heads-up is hard-coded as
`['BTN/SB', 'BB']` in the lookup table rather than derived, because the
button *is* the small blind 2-handed — the case that breaks any "seat after
the button" rule.

`splitPot` divides a chop evenly and gives the odd chip to the first
winning seat, so payouts always sum to exactly the pot — the same
one-place-absorbs-the-remainder convention as `calculatePayouts`.

`buildReplayFrames` (`replay.js`) is what the replayer steps through: one
frame per beat of the hand (each street dealt, each logged action, then the
settle), each carrying the whole table state at that moment — board, chips in
front of each seat, stacks, who has folded, the pot. `computeHandDerived`
answers "how did this add up" and collapses exactly the intermediate states a
replay needs, so this is a second walk over the same actions — but *not* a
second implementation of the rules: both live here, share the
`amount`-is-a-street-total convention and the same clamp on an under-committed
amount, and there is a test asserting the last frame's pot equals
`computeHandDerived().totalPot`. Only the browser renders it; it lives in
`shared/` because it is pure arithmetic and belongs next to the rules it
applies, which is also what makes it testable without a DOM. Frames carry
structured actions and numbers, never prose — wording a frame needs seat names
and locale-formatted chips, which is presentation.

Chips move in three stages, and the frames show all three: a bet sits in front
of a seat (`frame.bets`), gets swept into the middle when the next street is
dealt, and is paid out on the final frame — which is the only frame whose
`stacks` include a payout.

`analysis.js` is the one module here that asks *poker* questions of a logged
hand, and it is where the odds calculator's engine meets the hand logger:

- `isRunoutSpot(frame)` — is the hand past betting and just being dealt out?
  Three conditions, and the third is the one that's easy to miss: someone is
  all in, **at most one** live seat still has chips (a shove called by a bigger
  stack runs out identically — there's nobody left to bet at), and the betting
  is actually *matched*. Without that last check, a shove still facing a
  decision looks exactly like a called one, and the villain's cards turn face
  up while the hero is deciding whether to call them. It deliberately ignores
  the board, so it stays true through the river and cards that were turned over
  stay turned over.
- `findAllInRunout` narrows that to the spot worth pricing (cards still to
  come, two known holdings) and `runoutEquity` calls the shared
  `calculateEquity` against the frame's board — so the replay's equity moves
  street by street the way it does at a table. It passes a fixed seed:
  replaying the same hand twice must not print two different numbers, and a
  stable seed is cheaper than caching for that. `method` is surfaced, same as
  on the calculator page.
- `contestingSeats` is who is still in the pot, and the rule that makes
  auto-awarding workable in practice: **a seat that never acts and has no cards
  logged is not in the hand.** Hands are reconstructed from memory and people
  log the action that mattered, not six preflop folds — without this, "I raised
  and everyone folded" would read as six live players and the pot could never
  be awarded. A seat that posted a blind and then vanishes from the log is out,
  and its blind stays in the pot, which is what happened at the table.
- `determineWinners` settles the pot: one seat left contesting it wins (no
  cards needed, which is how most hands end); otherwise a complete board with
  every contesting holding logged is evaluated, chops included; otherwise
  nothing.
- `evaluateShowdown` names each hand that got there via `describeHand`. It uses
  the *same* seat set and the same all-holdings-known requirement as
  `determineWinners`, so it can never name a winner for a pot the hand refuses
  to award — two answers to one question is exactly the split this directory
  exists to prevent.

## Data store

`DataStore` (abstract) → `JsonFileStore` (JSON files) → a repository per record
type (`HistoryRepository`, `TournamentRepository`, `HandLogRepository`), each
exposing a domain-level API over the same store class. Services depend on the
repository, never on a concrete store, so swapping in SQLite means one new class
and one line in [src/server/store/index.js](src/server/store/index.js).

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
roster, clock, and blind level all change constantly — and `HandLogRepository`
uses it for `PATCH /api/hands/:id`, where the edit is merged over the stored
record and then validated in full. The read, `updater`
call, and write into the in-memory array happen synchronously in one tick
(only the disk `flush()` after is async), so two `update()` calls on the same
id can't interleave and silently lose one's change.

## Testing

`node:test` with `describe`/`it`. `npm test` discovers `**/*.test.js`.

- Domain tests go in `test/shared/`, server tests in `test/server/`. A pure
  frontend module with no DOM dependency can be tested too — `test/client/`
  covers `boardSlots.js`, which imports and runs in Node exactly as it does
  in the browser. There is no test infrastructure for React components.
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

**Routing.** Five routes (`/` → Odds Calculator, `/ranges` → Range Explorer,
`/tournament` → Tournament Manager, `/hands` → Hand Logger, `/hands/:id` →
one saved hand) still don't justify a router dependency, so `router.js` is a
~50-line hand-rolled one: a `useRoute()` hook backed by
`history.pushState`/`popstate`, and a `Link` component that intercepts a
plain left click. This is what "minimise dependencies" (see Conventions)
looks like in practice — reach for a library when the hand-written version
stops being trivial, not before.

`/hands/:id` is the first route carrying a parameter, and it needed no
router change at all: `useRoute()` already returns the raw pathname, so
`AppShell.pageFor` does one `startsWith` and slices the id off. Share links
(`?share=1`) did add one thing — `useSearchParam` — kept in `router.js` so
`window.location` still has exactly one reader.

**Where a navigation lands is the app's call, not the browser's.**
`router.js` sets `history.scrollRestoration = 'manual'` and scrolls to the top
in `notify()` — **before** the new path reaches any subscriber, which is the
part that matters. Leaving a tall page while scrolled down, the old order let
React commit the short page first: the document collapsed under a scroll
offset now past its end, the browser clamped the offset back to zero, and a
band of the page that just went away stayed painted below the new one (the
replayer's felt, unmistakable at 593px wide under a shell capped at 800px).
Scrolling from a component effect *after* the commit cannot fix that — the
clamp has already happened, and `scrollTo(0, 0)` at offset zero is a no-op
that invalidates nothing. Scrolling first means the document only ever shrinks
while the viewport is already at the top, so there is no offset to clamp. Note
this is not only a back/forward case: it bites a plain nav-link click too,
where `scrollRestoration` never enters into it.

That was half of it. The other half was `isolation: isolate` on `body`, now
removed — see the comment there, and don't put it back. Making the body its own
stacking context got the whole page rastered into tiles Chrome then failed to
invalidate when a tall route was replaced by a short one, leaving a band of the
previous page painted under the footer. Two symptoms are worth recognising
again, because between them they identify a *cached tile* rather than stale
pixels: the band never repainted (no flash under DevTools' paint flashing) and
yet it came back after a hover elsewhere on the page finished. It was found by
overriding the body's properties one at a time in the console, which is the
cheapest tool for this and worth reaching for before theorising — two
plausible-sounding diagnoses (the canvas background propagating off `body`,
and `body::before`'s `mask-image` forcing a composited layer) were both wrong,
and each cost a round trip to disprove.

**Going back.** `BackButton` is one arrow icon in the same place on every page
that can be arrived at from somewhere else, replacing a set of text buttons
("Back to list", "All hands") that each named a destination and so had to be
reworded — or be wrong — the moment a page could be reached from two places.
It defaults to `goBack(fallback)`, which pops history *only if this app pushed
an entry* (`router.js` counts them): a shared link opened in a fresh tab has
nothing to pop, and `history.back()` there would throw the user out of the app
entirely, so it navigates to the fallback instead. The Tournament Manager
passes `onClick` instead, because its list is state rather than a route. The
arrow is an inline SVG, not a glyph — see the suit-pip note below for why
characters can't be trusted to render as characters. It exists
because a saved hand has to be *linkable* — that's what "share" means here,
and it's why the Hand Logger splits list and detail across two routes
instead of switching on state the way the Tournament Manager does.

**The hand logger's table diagram.** `PokerTable` positions seats around the
felt with geometry into `left`/`top` percentages rather than drawing to SVG or
canvas, so every seat stays a real DOM button — focusable, clickable and
screen-reader-navigable for free. It renders whatever it's handed and reports
clicks upward; position labels are passed in (derived once by the page) rather
than computed inside, so the diagram can't disagree with the rest of the page
about who is on the button. Seats are edited by clicking one on the felt,
which reveals an editor for just that seat — ten seats' worth of fields never
appear at once, and the table stays visible.

The outline is a **stadium** (two semicircular ends joined by straight sides),
not an ellipse — that's the shape a real table is, and an ellipse left the
middle seats visibly off the felt because its sides curve away where a table's
run straight. Seats are spaced by *arc length* around that outline, not by
angle, which is what keeps the gaps even; angle-stepping bunches seats up at
the ends. All of it — the felt's box, the seat ring, and the container's
aspect ratio, applied inline — comes from one `TABLE_SHAPE` entry, because
geometry split between the component and the stylesheet drifts apart the first
time either side is edited alone. Narrow screens get a *round* table: with the
ring as wide as it is tall the stadium degenerates to a circle, so the same
maths handles it with no special case, and a `matchMedia` hook (not a CSS-only
breakpoint) switches shapes so the seats and the felt move together.

**Chips say how big.** A wager in front of a seat is drawn by `ChipStack.js`,
whose one table (`CHIP_TIERS`) decides both how tall the stack is and what
colour it is, in big blinds — one white chip up to a big blind (a blind, an
ante, a limp, a min bet), five purple ones past twenty. Height and colour come
out of the same row on purpose: with a single chip for everything, a seat that
already had dead money out looked identical after raising, and height alone
tops out, because past a handful of chips a stack can't get taller without
running off the felt. Colour carries the reading from there, the way a real
denomination does. Forced bets carry no caption at all: chips in front of a
seat that hasn't acted are self-evidently a blind, and labelling them put a
word on every seat on every preflop frame.

**The pot is chips, not a caption.** The middle of the felt draws a
`ChipStack` with the amount beside it, and no "Pot" label — the word was
naming what the picture already says. Nothing renders at zero, because an
empty middle is empty rather than a stack worth nothing, and the replayer's
caption no longer repeats the figure a centimetre below the felt. `ChipStack`
is `aria-hidden` (it is a drawing), so "Pot:" survives in a
`.visually-hidden` span — that utility class exists for exactly this: a
picture carrying the meaning on screen while the word stays for a screen
reader.

**Chips being pushed in is animated, and makes a noise.** Stepping forward
into a frame where the felt in front of every seat empties is the dealer's
sweep, and `PokerTable` flies a chip from each seat's bet position to the
centre for it (`sweepBets`, `CHIP_SWEEP_MS`). Three things about it:

- **Who decides versus who draws.** *When* a sweep happens is a fact about
  stepping through a replay, so `HandReplay` detects it — "there were chips
  out, now there are none", which identifies `collectStreet` exactly without
  special-casing streets. *Where* chips travel is geometry, so the animation
  lives next to it in `PokerTable`. The chips are mounted only while a sweep
  runs, so mounting starts the animation and unmounting ends it — no
  `animationend` listener, nothing to reset. The clearing timeout reads
  `chipSweepDurationMs`, the same function the stagger does, so a chip is
  never un-rendered mid-flight.
- **Only a single step forward animates.** Scrubbing or jumping would fire
  several sweeps at once on the way past. Note the matching hazard: the effect's
  cleanup cancels the pending timer, so any non-sweep step has to clear the
  chips itself or they strand on the felt.
- **The felt draws `chipsInMiddle`, not `frame.pot`.** A frame's `pot` is the
  whole hand's wager *including* chips still in front of seats — right for
  "what is this pot worth", wrong for "what is in the middle", and drawing it
  on the felt counted every live bet twice. Subtracting the outstanding bets
  makes the middle behave like a table: blinds sit in front of the blinds, a
  street's chips arrive only when the dealer pulls them in, and the middle
  holds still through a whole street of betting. It is computed in
  `HandReplay` rather than added to the frame, because `pot` means what it
  means and several places rely on it.
- **The whole table holds on `shownFrame` until the chips land.** A sweep
  carries the frame it started from, and the board, the pot, the headline, the
  street pill and the showdown all read from that until the last chip arrives
  — so the dealer gathers the bets *first* and the next card comes *after*,
  which is the order it happens at a table. Dealing the flop on the same beat
  the chips start moving does both halves at once and reads as the cards
  arriving before the street they belong to has been paid for. Only the chips
  in front of seats and their labels come from the live frame, where the sweep
  has already cleared them — those chips are the ones in flight, and drawing
  them at their seats too would show every bet twice. The pot's nudge is timed
  off `chipSweepDurationMs` so it lands with the last chip, not the first.
- A checked-through street sweeps nothing and correctly animates nothing.

The sound (`services/chipSounds.js`) is synthesised with Web Audio rather than
shipped as an audio file — the same dependency call the rest of the app makes,
and nothing loads on a page that never plays one. It is a dealer *raking*
chips in, built in layers:

- **Each chip is a click plus a ring.** The transient is a wide, very short
  burst — the strike. Under it a narrow, high-Q band rings on several times
  longer: the disc resonating. The click alone is a stick tapping a table; the
  ring is what makes it a *chip*, and it is what the first version lacked.
  Ring pitch is drawn per chip, so a pile clatters inharmonically the way a
  rack does instead of repeating one note.
- **A scrape underneath**, wide-band noise with its filter sweeping downward,
  which reads as a mass moving toward you rather than as static. Kept quiet:
  when the bed competes with the chips the whole thing turns to hiss.
- **Density and irregularity carry the atmosphere.** Below roughly a dozen
  knocks the ear picks them out and counts them, and an even stagger is heard
  as a rhythm — the one thing a pile of chips never is. So they are many, and
  scattered at random.

The `AudioContext` is built on the first sweep, not at import: one
constructed at page load is born `suspended` and silently drops its first
sound. Muting persists in `localStorage`, and the toggle's speaker is an
inline SVG for the reason the suit pips are — a glyph is one font
substitution from being a colour emoji.

The chips are **SVG, not styled `div`s** — same reason as the logo and the back
arrow. A chip is a shape (an ellipse seen from across the table, with a side
wall under it), and CSS can only fake that by overlapping circles, which is
what the first version did and why a stack read as one icon printed several
times. Each chip is drawn as a cylinder, but only the *top* one gets a face:
the wall of each chip plus the face above it exactly tile the face below, so
the whole stack is painted once with nothing showing through. The stripes
running down the side walls are the detail that sells it at felt size — they
are what the eye reads as "separate chips" long before it can count them.
`ChipStack.js` owns every number about a chip; the stylesheet sets its width
and nothing else.

**The mark on the felt.** `Logo.js` holds the spade as an SVG path, used at
both sizes it appears in: the header wordmark, and the faded logo stitched
into the middle of the table. It is a path and not the `♠` character for the
same reason the playing cards carry a text-presentation selector — a suit
character is one font substitution away from rendering as a colour emoji, and
a logo that changes shape per machine isn't a logo. On the felt it is
`aria-hidden`, sits behind the board and pot, and is kept at an opacity low
enough to read as part of the cloth; anything more competes with the cards.

**Two card renderers, on purpose.** `CardBadge` is the compact token for a card
mentioned inline — a result row, a history entry, a list. `PlayingCard` is a
card drawn as a card (white face, rank over a single pip) for the places the
card itself is what's being studied: the board and the hole cards on the felt.
The felt rendered with badges read as a list of codes rather than a table.
Face-down is `PlayingCard`'s empty state, which is why a read-only table shows
backs for an unknown holding instead of a dash.

The face carries the suit **once**. A corner index plus a centre pip is what a
real card does at real size; in a 2.4rem box the two collide into a smudge,
which is what the first version shipped. Suit glyphs also need help to stay
glyphs: they carry U+FE0E (text presentation) in the markup and `--font-symbol`
in CSS, or the browser is free to swap in a colour emoji font — Segoe UI Emoji
on Windows — which ignores the suit colour and renders as a blob at card size.

**The replayer.** `HandReplay` is the default view of a saved hand: arrows (and
the left/right keys, and a scrubber, and a clickable timeline) step through the
frames from `buildReplayFrames`, and the table re-renders with that frame's
board, chips, stacks and folds. The component holds one piece of state — which
frame — and does no arithmetic of its own; everything it shows comes out of the
shared domain. That split is deliberate: a replayer that recomputed the pot as
it stepped would be the second betting implementation this codebase keeps
warning about. It holds two further pieces of purely visual state — which
chips are mid-sweep, and whether sound is muted — neither of which any
number on the page is derived from.

**Motion is always confirmation, never information.** Everything animated
here restates something the frame already shows, so
`prefers-reduced-motion: reduce` switches it off with nothing lost. Honour
that on anything added later; it is the whole reason the rule is cheap to
keep.

**View-only shared hands.** View-only is for the person a hand was *shared
with*, and nobody else. Two conditions have to line up for it: the link says
it was shared (`?share=1`, which is what the copy-link button hands out), and
this browser isn't the one that logged the hand (`services/handOwnership.js`,
which keeps created ids in `localStorage` — "author" without accounts can only
mean "logged from this browser"). So the author keeps edit and delete on their
own hand even following their own share link, and a hand opened from the list
is never locked, including ones logged before authorship was tracked at all.
**This decides what the page offers, not what the server permits** — the API
has no notion of an owner, and the flag is a URL edit away from being removed.
It is the honest version of the feature until there are real accounts; don't
mistake it for access control, and don't build anything on it that needs
enforcing.

**What the replay shows of a holding.** Hero's cards are face-up throughout —
a replay is watched from the hero's seat, and hiding what they held makes
their decisions unreadable. Everyone else stays face-down until their cards
became public at the table: at showdown, or the moment the last bet goes in on
an all-in with cards to come, which is when a real table turns them over. A
hand that ended with everyone folding reaches neither, so nothing is turned
over even when the log knows the villain's cards. That's `revealSeats` on
`PokerTable`: omitted, every known card shows (what the editor and the
write-up want), and only the replay passes it.

**Starting stacks are one field.** `HandBuilderForm` carries a base stack that
writes through to every seat, and that any seat added by growing the table
inherits; individual seats are still editable on the felt afterwards. It is
component state, **not** part of the record — the hand stores what each seat
actually had, and a second copy of "what they all started with" would be one
more thing able to disagree with the seats themselves. It seeds from the hand
being edited, so reopening one doesn't reset it.

**There is no winner picker.** The old Result panel is now an Outcome panel
that *reports* what `determineWinners` read off the hand, and says what is
missing when the hand doesn't answer the question yet — the only thing the
user can usefully do about it. The result notes field stays, because a
takeaway is the user's own and can't be derived from anything.

**Logging an action is a click, not a sum.** `HandStreetEditor` knows what the
acting seat faces (`streetBettingState`), so it offers the action rather than
asking for it: Fold, Check-or-Call (only the applicable one — offering both is
how a log ends up with a "check" facing a raise), All in, and a slider from a
minimum to the seat's stack with ½/¾/pot shortcuts. Nobody types an amount to
call. That matters most for this app's street-total convention: "call 600"
when you already have 100 out is the single most confusable number in a hand
log, which is why the button says `Call 600 (+500)` — the total is what goes
on the record, the increment is what leaves the stack. Sizing shortcuts round
to the **small** blind, not the big one: at 50/100 a pot-sized raise is 350,
and rounding to the big blind would round it up to 400, overshooting the thing
it is named after. The number field stays free-typed, because a slider bounded
by legality can't log a hand where something illegal actually happened.

**Live equity and the showdown.** On an all-in run-out the replay shows each
contesting hand's equity — beside that seat's cards on the felt
(`equityBySeat` on `PokerTable`) and in a panel with bars and the method
badge (`AllInEquity`) — recomputed against the board on every frame, so it
moves as the turn and river land. It is the same
`calculateEquity` the odds calculator uses, run in the browser rather than
posted to the API — the spot is small (a flop with two to come enumerates
exactly) and there is nothing to record. Results are cached in a ref keyed by
board + contestants, because scrubbing back and forth revisits the same spots
and a preflop all-in is the one genuinely expensive thing on the page. Once
the board completes, `ShowdownResult` names each hand in full ("Two pair,
kings and queens") and says who won. The showdown reads on the **river frame**
for a run-out, not one step later on the settle — the river landing is what
settles it — and only at the end for a hand that was still being bet.

Board cards, like every other card position in this app, are **fixed-size
arrays with `null` holes** while being edited. Closing the gaps as cards are
picked would slide a card chosen for the third flop slot down into the
first one the moment it was selected. The nulls are stripped by
`validateHandLogRequest` on save, which is also what rejects a half-dealt
street.

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

**Emptying a slot is `onPick(null)`.** The picker decides what a click means
and hands the page a card or a `null`; pages assign whatever they are given
rather than each re-deriving a toggle. Clearing was technically possible long
before it was findable — re-clicking the highlighted card did it — but
`.card-option.is-selected` was styled `cursor: not-allowed` and dimmed, so the
only way to undo a pick was drawn as the one thing you were forbidden to do.
The fix is a "Remove card" button in the picker footer; the re-click still
works and the highlight is now accent-coloured and clickable. Treat this as
the general lesson it is: an affordance nobody can find is a missing feature,
and styling is what says which is which.

**Clearing a board card clears the streets after it** (`boardSlots.js`).
The Odds Calculator and the Range Explorer both flatten the board with
`.filter(Boolean)` before posting it, so a
hole in the middle silently closes up: clear the turn with a river dealt and
the board still flattens to four cards — a legal turn board — with the river
sitting in the turn's place, returning a confidently wrong number instead of
an error. Wrong-but-plausible is the worst outcome available, so
`clearBoardCard` takes the later streets too, which is also just how a hand
runs. Sibling cards in the same street are spared: a flop is dealt at once,
so a hole there is an incomplete board, and the street-boundary check rejects
that with a real message. The rule lives in its own module rather than in
either page because both need it identically, and one correctness rule kept
in two places is the drift this codebase already has a lesson about. The hand
logger needs none of this — its streets are separate boards, so nothing
shifts, and `validateHandLogRequest` refuses a turn dealt before a flop
outright rather than reading the cards one street early.

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
| `PATCH` | `/api/tournaments/:id` | Update settings; only while `status === 'setup'`, except a payout-split-only patch, which is also allowed once registration has closed |
| `DELETE` | `/api/tournaments/:id` | Delete a tournament |
| `POST` | `/api/tournaments/:id/reset` | Reset to `setup`: clock to level 0, player progress cleared, registration reopened, roster and settings kept |
| `PATCH` | `/api/tournaments/:id/registration` | `{action: 'close'\|'reopen'}` |
| `POST` | `/api/tournaments/:id/players` | Register a player; refused once registration is closed |
| `DELETE` | `/api/tournaments/:id/players/:playerId` | Remove a registration; only while `status === 'setup'` |
| `PATCH` | `/api/tournaments/:id/players/:playerId` | `{action: 'rebuy'\|'addon'\|'eliminate'\|'reinstate'}` |
| `PATCH` | `/api/tournaments/:id/clock` | `{action: 'start'\|'pause'\|'resume'\|'advance'\|'setLevel', levelIndex?}` |
| `POST` | `/api/hands` | Save a logged hand |
| `GET` | `/api/hands` | List saved hands (lightweight summaries) |
| `GET` | `/api/hands/:id` | Full record, decorated with `derived` (positions, pot progression, payouts) |
| `PATCH` | `/api/hands/:id` | Edit a saved hand; merged over the stored record, then validated in full |
| `DELETE` | `/api/hands/:id` | Delete a saved hand |

Everything under `/api`. Non-API paths fall through to `index.html` so
client-side routing survives a hard refresh; API 404s stay real 404s.

## Roadmap

Keep this section current — it is how a new session learns what "next" means.

1. **Poker simulator** *(next)* — deal full hands from a seeded `Deck`, run
   configurable spots, record results as `RECORD_TYPES.SIMULATION`. The pieces
   already in place for it: `Deck`, `Rng`, `findWinners`, and the record-type
   discriminator in `HistoryRepository`.
2. **Session tracker** — aggregate stored records into trends over time.
   Saved hands are the obvious second input alongside history records.
3. **PR process** — GitHub Actions running `npm test`, plus build artifacts.
4. **Tournament seating/table balancing** — the manager currently tracks
   registration, stacks, the clock, and payouts, but not seat assignments;
   a natural extension once multi-table events are in scope.
5. **Hand-log extras** — equity at every *decision*, not just at an all-in
   (the frame is already the right input; what's missing is a defensible way
   to show a number for a spot where folding is still possible), autoplay for
   the replayer, and import from a site's hand-history text format. The
   structured `streets`/`actions` model was chosen with these in mind.

## Gotchas

- `data/` contents are gitignored; `data/.gitkeep` is tracked so the directory exists.
- Cards are case-normalised at the validation boundary (`normalizeCard`), so
  domain code can assume canonical form.
- `combinations()` **reuses its output array** for every yield — copy it if you
  need to retain it beyond the loop iteration.
- The equity engine credits split pots fractionally, so every player's equity
  sums to exactly 1. Don't "fix" this to whole-number win counts.
- **Never nest a `<form>` inside another `<form>`, and give every `<button>`
  inside a form an explicit `type`.** A button with no `type` defaults to
  `type="submit"`, and nested forms are invalid HTML with undefined
  submit-owner behaviour. This has already bitten the hand logger once: the
  per-street "Add action" button lived in a nested form, so clicking it
  submitted the outer form natively — a GET to the current URL, which reloads
  the SPA and dumps the user back on the list page having lost the hand they
  were building. `HandStreetEditor` is a `div` with `type="button"` for
  exactly this reason. The symptom to recognise: a click that "goes back to
  the menu" is almost always an unprevented form submit reloading the page.
