/**
 * Tournament Manager page.
 *
 * Three views in one component, switched on state rather than sub-routes
 * (there's nothing here worth deep-linking to): a list of saved tournaments,
 * a creation form, and the live dashboard for whichever tournament is open.
 *
 * The clock is the trickiest part. The server is the source of truth for
 * *when* the current level started (`clock.levelStartedAt`) and how much
 * paused time has already accumulated (`clock.pausedElapsedMs`), but the
 * *display* re-derives the countdown locally every second via the shared
 * `computeClockState` -- the same function `derived.clock` on the server ran
 * -- rather than polling once a second. A slower background poll (every few
 * seconds) resyncs in case another device paused or advanced the clock. When
 * the locally-computed countdown hits zero, this page (whichever one has it
 * open) calls the advance action once; there's no server-side cron doing it,
 * so a tournament with nobody watching its clock simply waits at 0:00 rather
 * than silently skipping levels.
 */

import { activePlayerCount, computeClockState, generateBlindStructure, suggestPayoutSplit } from '/shared/tournament/index.js';
import { BackButton } from '../components/BackButton.js';
import { useAuth } from '../context/AuthContext.js';
import { navigate, useRoute, useSearchParam } from '../router.js';
import { TournamentClock } from '../components/TournamentClock.js';
import { TournamentPayouts } from '../components/TournamentPayouts.js';
import { TournamentRoster } from '../components/TournamentRoster.js';
import { TournamentStatus } from '../components/TournamentStatus.js';
import {
  createTournament,
  deleteTournament,
  fetchTournament,
  fetchTournaments,
  registerTournamentPlayer,
  removeTournamentPlayer,
  resetTournament,
  saveTournament,
  updateTournamentClock,
  updateTournamentPlayer,
  updateTournamentRegistration,
  updateTournamentSettings
} from '../services/apiClient.js';
import { forgetTournament, isMyTournament, listRememberedTournaments, rememberTournament } from '../services/tournamentOwnership.js';

const e = React.createElement;

const CLOCK_TICK_MS = 1000;
const RESYNC_MS = 6000;

/** A short two-tone chime via the Web Audio API -- no asset, no dependency. */
function playLevelChangeChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.connect(ctx.destination);

    [880, 1320].forEach((frequency, i) => {
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(ctx.currentTime + i * 0.16);
      oscillator.stop(ctx.currentTime + i * 0.16 + 0.15);
    });

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio is a nice-to-have; a browser that blocks it shouldn't break the clock.
  }
}

/** @param {number} amount @returns {string} */
function formatMoney(amount) {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Reshape a full, decorated tournament (what `fetchTournament` returns) into
 * the lightweight summary shape the list view renders (what the server's own
 * `GET /api/tournaments` normally returns). Needed only for the logged-out
 * landing view: with no list endpoint available anonymously any more, that
 * view rebuilds its list itself by fetching each remembered id individually,
 * and this is what lets it feed the same `TournamentListView` rendering
 * rather than growing a second display for one case.
 * @param {object} tournament
 * @returns {object}
 */
function summarizeForList(tournament) {
  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    createdAt: tournament.createdAt,
    playerCount: tournament.players.length,
    activePlayerCount: activePlayerCount(tournament.players),
    clockStatus: tournament.clock.status,
    currentLevel: tournament.derived.clock.level,
    isFinalLevel: tournament.derived.clock.isFinalLevel
  };
}

function CreateTournamentForm({ onCreate, onCancel }) {
  const [name, setName] = React.useState('');
  const [startingStack, setStartingStack] = React.useState(10000);
  const [buyIn, setBuyIn] = React.useState(20);
  const [levelMinutes, setLevelMinutes] = React.useState(15);
  const [levelCount, setLevelCount] = React.useState(16);
  const [error, setError] = React.useState(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) {
      setError({ message: 'Name is required.' });
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const structure = generateBlindStructure({ levelMinutes: Number(levelMinutes), levelCount: Number(levelCount) });
      await onCreate({ name: name.trim(), startingStack: Number(startingStack), buyIn: Number(buyIn), structure });
    } catch (err) {
      setError({ message: err.message, details: err.details });
    } finally {
      setIsSubmitting(false);
    }
  }

  return e(
    'form',
    { className: 'card-form', onSubmit: handleSubmit },
    e(
      'div',
      { className: 'field-row' },
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'tournament-name' }, 'Name'),
        e('input', { id: 'tournament-name', type: 'text', value: name, onChange: ev => setName(ev.target.value), maxLength: 80 })
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'starting-stack' }, 'Starting stack'),
        e('input', {
          id: 'starting-stack', type: 'number', min: 100, step: 100,
          value: startingStack, onChange: ev => setStartingStack(ev.target.value)
        })
      )
    ),
    e(
      'div',
      { className: 'field-row' },
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'buy-in' }, 'Buy-in ($)'),
        e('input', { id: 'buy-in', type: 'number', min: 1, step: 1, value: buyIn, onChange: ev => setBuyIn(ev.target.value) })
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'level-minutes' }, 'Minutes per level'),
        e('input', {
          id: 'level-minutes', type: 'number', min: 1, step: 1,
          value: levelMinutes, onChange: ev => setLevelMinutes(ev.target.value)
        })
      )
    ),
    e(
      'div',
      { className: 'field-group' },
      e('label', { htmlFor: 'level-count' }, 'Number of levels'),
      e('input', {
        id: 'level-count', type: 'number', min: 1, max: 29, step: 1,
        value: levelCount, onChange: ev => setLevelCount(ev.target.value)
      }),
      e('span', { className: 'footnote' }, 'Rebuy/add-on amounts default to the starting stack and buy-in; edit them from the dashboard once players are in.')
    ),
    error ? e('p', { className: 'footnote range-notation-error' }, error.message) : null,
    e(
      'div',
      { className: 'form-actions' },
      e('button', { type: 'submit', disabled: isSubmitting }, isSubmitting ? 'Creating...' : 'Create tournament'),
      e('button', { type: 'button', className: 'ghost-button', onClick: onCancel }, 'Cancel')
    )
  );
}

function TournamentListView({
  tournaments,
  isLoading,
  error,
  showCreateForm,
  onShowCreate,
  onCreate,
  onCancelCreate,
  onOpen,
  onDelete,
  isAuthenticated
}) {
  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, 'Tournament Manager'),
    e('p', { className: 'small' }, 'Register players, run the blind clock, and see live stack and payout math. Log in to save the tournaments you create and find them again later.'),

    showCreateForm
      ? e(CreateTournamentForm, { onCreate, onCancel: onCancelCreate })
      : e('button', { type: 'button', onClick: onShowCreate }, '+ New tournament'),

    // No server list to ask at all when logged out -- `GET /api/tournaments`
    // requires a session now. `tournaments` still carries whatever this
    // browser remembers creating anonymously in that case (see
    // `listRememberedTournaments`), and while logged in it's the server's
    // list plus any still-unowned remembered ones the server list wouldn't
    // otherwise mention -- see `refreshList`. Either way it's one shape, so
    // one list rendering below covers both.
    !isAuthenticated
      ? e('p', { className: 'footnote' }, "Log in to see tournaments you've saved.")
      : null,

    error ? e('p', { className: 'footnote range-notation-error' }, error) : null,

    showCreateForm
      ? null
      : isLoading
      ? e('p', { className: 'footnote' }, 'Loading tournaments...')
      : tournaments.length === 0
        ? e('p', { className: 'footnote' }, 'No tournaments yet.')
        : e(
            'ul',
            { className: 'tournament-list' },
            tournaments.map(tournament =>
              e(
                'li',
                { key: tournament.id, className: 'tournament-list-item' },
                e(
                  'button',
                  { type: 'button', className: 'tournament-list-open', onClick: () => onOpen(tournament.id) },
                  e('span', { className: 'tournament-list-name' }, tournament.name),
                  e(
                    'span',
                    { className: 'footnote tournament-list-status' },
                    e(TournamentStatus, {
                      status: tournament.status,
                      clockStatus: tournament.clockStatus,
                      level: tournament.currentLevel,
                      isFinalLevel: tournament.isFinalLevel
                    }),
                    `${tournament.activePlayerCount}/${tournament.playerCount} players`
                  )
                ),
                e('button', {
                  type: 'button',
                  className: 'ghost-button danger',
                  onClick: () => onDelete(tournament.id),
                  'aria-label': `Delete ${tournament.name}`
                }, '×')
              )
            )
          )
  );
}

export function TournamentManagerPage() {
  const { status: authStatus, user } = useAuth();
  const path = useRoute();
  const resumeId = useSearchParam('resume');
  const [tournaments, setTournaments] = React.useState([]);
  const [isLoadingList, setIsLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState(null);
  const [showCreateForm, setShowCreateForm] = React.useState(false);

  const [tournament, setTournament] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [, forceTick] = React.useState(0);

  const advancingRef = React.useRef(false);
  const lastLevelRef = React.useRef(null);

  // Logged in, the list shown is exactly and only what `GET
  // /api/tournaments` returns -- no local history merged in. `localStorage`
  // is scoped to this *browser*, not to whoever happens to be logged in, so
  // merging it into an authenticated list would leak any tournament ever
  // created anonymously on this machine into whichever account is currently
  // signed in, regardless of whether it's actually theirs. Logged out, there
  // is no server list to ask at all (`GET /` requires a session now), so
  // this is the one place `listRememberedTournaments()` still belongs --
  // finding your own anonymous tournament again after a reload, with no
  // account involved at all.
  const refreshList = React.useCallback(async () => {
    // Wait for the initial auth check rather than guessing: fetching the
    // real list and then discarding it a moment later (or the reverse) would
    // just be a flash of the wrong content.
    if (authStatus === 'loading') return;

    setIsLoadingList(true);
    try {
      if (authStatus === 'authenticated') {
        const page = await fetchTournaments({ limit: 50 });
        setTournaments(page.items);
      } else {
        const rememberedIds = listRememberedTournaments();
        const remembered = (await Promise.all(rememberedIds.map(id => fetchTournament(id).catch(err => {
          if (err.status === 404) forgetTournament(id);
          return null;
        })))).filter(Boolean);
        setTournaments(remembered.map(summarizeForList));
      }
      setListError(null);
    } catch (err) {
      setListError(err.message);
    } finally {
      setIsLoadingList(false);
    }
  }, [authStatus]);

  React.useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Coming back from the login redirect `handleSave` sends an anonymous
  // caller through: `?resume=<id>` exists for exactly one reason, so once a
  // session is actually available this finishes what clicking Save started
  // -- claiming it -- rather than just redisplaying it and leaving a second,
  // now-redundant click for the user to make. Never by touching the list or
  // local history either way, which is the whole point of carrying the id
  // itself instead of falling back to scanning everything this browser
  // remembers.
  //
  // A direct or repeat visit to this same URL is handled without erroring:
  // already-saved-by-this-account (422) or claimed-by-someone-else (404)
  // both fall back to a plain read, so the page still lands on the
  // tournament -- or on whatever it can actually show -- rather than
  // surfacing a failed save as if the whole thing broke.
  React.useEffect(() => {
    if (!resumeId || authStatus === 'loading') return;

    const load = authStatus === 'authenticated'
      ? saveTournament(resumeId).catch(err => {
          if (err.status === 404 || err.status === 422) return fetchTournament(resumeId);
          throw err;
        })
      : fetchTournament(resumeId);

    load.then(setTournament).catch(err => setListError(err.message));
  }, [resumeId, authStatus]);

  // Tick once a second while a tournament is open, purely to force a
  // re-render so the locally-computed countdown keeps moving.
  React.useEffect(() => {
    if (!tournament) return undefined;
    const id = setInterval(() => forceTick(t => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [tournament?.id]);

  // Periodically resync with the server in case another device changed
  // something (paused the clock, registered a player, ...).
  React.useEffect(() => {
    if (!tournament) return undefined;
    const id = setInterval(() => {
      fetchTournament(tournament.id).then(setTournament).catch(() => {});
    }, RESYNC_MS);
    return () => clearInterval(id);
  }, [tournament?.id]);

  const liveClock = tournament
    ? computeClockState({ structure: tournament.structure, ...tournament.clock }, Date.now())
    : null;

  // Auto-advance the level once the local countdown reaches zero. Guarded on
  // tournament status too: a completed tournament's clock is left exactly
  // where it stopped rather than continuing to tick in the background.
  React.useEffect(() => {
    if (!tournament || !liveClock) return;
    if (
      tournament.status === 'active' &&
      liveClock.isLevelComplete &&
      tournament.clock.status === 'running' &&
      !liveClock.isFinalLevel &&
      !advancingRef.current
    ) {
      advancingRef.current = true;
      updateTournamentClock(tournament.id, 'advance')
        .then(setTournament)
        .catch(() => {})
        .finally(() => { advancingRef.current = false; });
    }
  });

  // Chime whenever the level actually changes (covers both auto-advance and
  // a manual skip), but never on the initial load of a tournament.
  React.useEffect(() => {
    if (!tournament) {
      lastLevelRef.current = null;
      return;
    }
    if (lastLevelRef.current !== null && lastLevelRef.current !== tournament.clock.currentLevelIndex) {
      playLevelChangeChime();
    }
    lastLevelRef.current = tournament.clock.currentLevelIndex;
  }, [tournament?.clock.currentLevelIndex]);

  async function openTournament(id) {
    try {
      setTournament(await fetchTournament(id));
      setError(null);
    } catch (err) {
      setListError(err.message);
    }
  }

  function backToList() {
    setTournament(null);
    setError(null);
    refreshList();
  }

  async function handleCreate(payload) {
    const created = await createTournament(payload);
    // Harmless when logged in (the server's own list already covers it);
    // what makes an anonymous tournament findable again after a reload when
    // it isn't.
    rememberTournament(created.id);
    setShowCreateForm(false);
    setTournament(created);
  }

  async function handleDeleteFromList(id) {
    await deleteTournament(id);
    forgetTournament(id);
    refreshList();
  }

  async function handleDeleteOpen() {
    await deleteTournament(tournament.id);
    forgetTournament(tournament.id);
    backToList();
  }

  async function withErrorHandling(action) {
    try {
      setTournament(await action());
      setError(null);
    } catch (err) {
      setError({ message: err.message, details: err.details });
    }
  }

  /**
   * Claim the open tournament for the caller. Logged out, this is the exact
   * redirect `RequireAuth` uses to gate a whole page -- reused here for one
   * button instead, since the Tournament Manager itself stays reachable
   * anonymously and can't be gated the same way a protected page is.
   *
   * The plain page path isn't enough on its own: this page has no per-
   * tournament route to begin with (`path` is always just `/tournament`),
   * so the redirect target has to carry *which* tournament to come back to
   * itself, as its own `?resume=<id>` -- `resumeId` below is what reads it
   * back out once login returns here. That nested query string goes through
   * `encodeURIComponent` exactly once, same as the plain-path case
   * `RequireAuth` handles elsewhere; `useSearchParam('next')` on the other
   * end decodes it back in one step, `?` and all.
   */
  function handleSave() {
    if (authStatus !== 'authenticated') {
      const resumePath = `${path}?resume=${encodeURIComponent(tournament.id)}`;
      navigate(`/login?next=${encodeURIComponent(resumePath)}`);
      return;
    }
    return withErrorHandling(() => saveTournament(tournament.id));
  }

  if (!tournament) {
    return e(TournamentListView, {
      tournaments,
      isLoading: isLoadingList,
      error: listError,
      showCreateForm,
      onShowCreate: () => setShowCreateForm(true),
      onCreate: handleCreate,
      onCancelCreate: () => setShowCreateForm(false),
      onOpen: openTournament,
      onDelete: handleDeleteFromList,
      isAuthenticated: authStatus === 'authenticated'
    });
  }

  // For an owned tournament, this can only ever be reached as its owner --
  // `openTournament` would have 404'd otherwise, since `#assertAccessible`
  // now gates reads too -- but the real identity check is cheap and correct
  // regardless, and it's what stops the controls surviving a stale session
  // change in the same tab. For an unowned one, there is no real identity to
  // check against, so this falls back to the soft, local-only signal.
  const canEdit = tournament.userId
    ? user?.id === tournament.userId
    : isMyTournament(tournament.id);

  return e(
    'div',
    { className: 'hero-card' },
    e(
      'div',
      { className: 'tournament-header' },
      e('div', null,
        e('h1', null, tournament.name),
        // The live clock, not the stored one: the header's level has to change
        // the moment the countdown rolls over, the same as the clock panel's.
        e('p', { className: 'small' }, e(TournamentStatus, {
          status: tournament.status,
          clockStatus: tournament.clock.status,
          level: liveClock.level,
          isFinalLevel: liveClock.isFinalLevel
        }))
      ),
      e(
        'div',
        { className: 'form-actions' },
        // The list is state here, not a route, so the return control is given
        // the handler rather than being left to pop history.
        e(BackButton, { onClick: backToList, label: 'Back to all tournaments' }),
        // Once a tournament has a `userId` there's nothing left to save --
        // the button only ever appears for the still-unowned case.
        !tournament.userId
          ? e('button', { type: 'button', className: 'ghost-button', onClick: handleSave }, 'Save')
          : null,
        canEdit && tournament.status !== 'setup'
          ? e('button', {
              type: 'button',
              className: 'ghost-button',
              onClick: () => withErrorHandling(() => resetTournament(tournament.id))
            }, 'Reset')
          : null,
        canEdit
          ? e('button', { type: 'button', className: 'ghost-button danger', onClick: handleDeleteOpen }, 'Delete')
          : null
      )
    ),

    e(
      'div',
      { className: 'tournament-stats-bar' },
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Players'),
        e('strong', null, `${tournament.derived.activePlayerCount} / ${tournament.players.length}`)),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Average stack'),
        e('strong', null, Math.round(tournament.derived.averageStack).toLocaleString())),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Chips in play'),
        e('strong', null, tournament.derived.totalChipsInPlay.toLocaleString())),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Prize pool'),
        e('strong', null, formatMoney(tournament.derived.prizePool)))
    ),

    error ? e('p', { className: 'footnote range-notation-error' }, error.message) : null,

    e(
      'div',
      { className: 'range-columns' },
      e(
        'div',
        { className: 'range-panel' },
        e(TournamentClock, {
          status: tournament.status,
          clockStatus: tournament.clock.status,
          liveClock,
          canEdit,
          onAction: action => withErrorHandling(() => updateTournamentClock(tournament.id, action))
        })
      ),
      e(
        'div',
        { className: 'range-panel' },
        e(TournamentPayouts, {
          prizePool: tournament.derived.prizePool,
          payouts: tournament.derived.payouts,
          players: tournament.players,
          // Editable pre-start (the usual case), or once registration has
          // closed -- that's what lets the split be finalized against the
          // field's actual final size instead of only the pre-start guess.
          // Gated on `canEdit` first: a viewer with no access to this
          // tournament's controls gets no stepper regardless of status.
          isEditable: canEdit && (tournament.status === 'setup' || (!tournament.registrationOpen && tournament.status !== 'completed')),
          onChangePlaces: places => withErrorHandling(() => updateTournamentSettings(tournament.id, {
            payoutSplit: suggestPayoutSplit(places)
          }))
        })
      )
    ),

    e(
      'div',
      { className: 'range-panel range-controls' },
      e(
        'div',
        { className: 'range-panel-head' },
        e('h2', null, 'Players'),
        tournament.status !== 'completed'
          ? e(
              'div',
              { className: 'form-actions' },
              e('span', { className: 'footnote' }, tournament.registrationOpen ? 'Registration open' : 'Registration closed'),
              canEdit
                ? e('button', {
                    type: 'button',
                    className: 'ghost-button',
                    onClick: () => withErrorHandling(() => updateTournamentRegistration(
                      tournament.id,
                      tournament.registrationOpen ? 'close' : 'reopen'
                    ))
                  }, tournament.registrationOpen ? 'Close registration' : 'Reopen registration')
                : null
            )
          : null
      ),
      e(TournamentRoster, {
        players: tournament.players,
        status: tournament.status,
        registrationOpen: tournament.registrationOpen,
        canEdit,
        onRegister: name => withErrorHandling(() => registerTournamentPlayer(tournament.id, name)),
        onPlayerAction: (playerId, action) => withErrorHandling(() => updateTournamentPlayer(tournament.id, playerId, action)),
        onRemove: playerId => withErrorHandling(() => removeTournamentPlayer(tournament.id, playerId))
      })
    )
  );
}
