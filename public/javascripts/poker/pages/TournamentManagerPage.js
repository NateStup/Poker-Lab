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

import { computeClockState, generateBlindStructure, suggestPayoutSplit } from '/shared/tournament/index.js';
import { BackButton } from '../components/BackButton.js';
import { useAuth } from '../context/AuthContext.js';
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
  updateTournamentClock,
  updateTournamentPlayer,
  updateTournamentRegistration,
  updateTournamentSettings
} from '../services/apiClient.js';

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
  isAuthenticated,
  mineOnly,
  onChangeMineOnly
}) {
  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, 'Tournament Manager'),
    e('p', { className: 'small' }, 'Register players, run the blind clock, and see live stack and payout math. Log in to save the tournaments you create and find them again later.'),

    showCreateForm
      ? e(CreateTournamentForm, { onCreate, onCancel: onCancelCreate })
      : e('button', { type: 'button', onClick: onShowCreate }, '+ New tournament'),

    // Visible only when logged in -- a logged-out visitor has no "mine" to
    // scope to, so the control simply isn't there rather than being shown
    // disabled.
    !showCreateForm && isAuthenticated
      ? e(
          'label',
          { className: 'footnote' },
          e('input', {
            type: 'checkbox',
            checked: mineOnly,
            onChange: ev => onChangeMineOnly(ev.target.checked)
          }),
          ' My tournaments'
        )
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
  const { status: authStatus } = useAuth();
  const [tournaments, setTournaments] = React.useState([]);
  const [isLoadingList, setIsLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState(null);
  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [mineOnly, setMineOnly] = React.useState(false);

  const [tournament, setTournament] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [, forceTick] = React.useState(0);

  const advancingRef = React.useRef(false);
  const lastLevelRef = React.useRef(null);

  // A logged-out visitor's behavior stays exactly as it is today, with no
  // way to reach a "mine"-filtered list -- if a session ends while the
  // toggle happened to be on, this puts it back rather than leaving a
  // filter active with nothing on screen to show it's there.
  React.useEffect(() => {
    if (authStatus !== 'authenticated') setMineOnly(false);
  }, [authStatus]);

  const refreshList = React.useCallback(async () => {
    setIsLoadingList(true);
    try {
      const page = await fetchTournaments({ limit: 50, mine: mineOnly });
      setTournaments(page.items);
      setListError(null);
    } catch (err) {
      setListError(err.message);
    } finally {
      setIsLoadingList(false);
    }
  }, [mineOnly]);

  React.useEffect(() => {
    refreshList();
  }, [refreshList]);

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
    setShowCreateForm(false);
    setTournament(created);
  }

  async function handleDeleteFromList(id) {
    await deleteTournament(id);
    refreshList();
  }

  async function handleDeleteOpen() {
    await deleteTournament(tournament.id);
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
      isAuthenticated: authStatus === 'authenticated',
      mineOnly,
      onChangeMineOnly: setMineOnly
    });
  }

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
        tournament.status !== 'setup'
          ? e('button', {
              type: 'button',
              className: 'ghost-button',
              onClick: () => withErrorHandling(() => resetTournament(tournament.id))
            }, 'Reset')
          : null,
        e('button', { type: 'button', className: 'ghost-button danger', onClick: handleDeleteOpen }, 'Delete')
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
          isEditable: tournament.status === 'setup' || (!tournament.registrationOpen && tournament.status !== 'completed'),
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
              e('button', {
                type: 'button',
                className: 'ghost-button',
                onClick: () => withErrorHandling(() => updateTournamentRegistration(
                  tournament.id,
                  tournament.registrationOpen ? 'close' : 'reopen'
                ))
              }, tournament.registrationOpen ? 'Close registration' : 'Reopen registration')
            )
          : null
      ),
      e(TournamentRoster, {
        players: tournament.players,
        status: tournament.status,
        registrationOpen: tournament.registrationOpen,
        onRegister: name => withErrorHandling(() => registerTournamentPlayer(tournament.id, name)),
        onPlayerAction: (playerId, action) => withErrorHandling(() => updateTournamentPlayer(tournament.id, playerId, action)),
        onRemove: playerId => withErrorHandling(() => removeTournamentPlayer(tournament.id, playerId))
      })
    )
  );
}
