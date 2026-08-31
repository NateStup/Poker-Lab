/**
 * Hand Logger index: the list of saved hands, and the form for logging a new
 * one.
 *
 * Unlike the Tournament Manager -- which keeps its list and its detail view in
 * one component switched on state -- a saved hand gets its own route so it can
 * be linked to. This page therefore only ever shows the list (or the new-hand
 * form); opening a hand navigates to `/hands/:id` rather than swapping state.
 */

import { createEmptyHand } from '/shared/handLog/index.js';
import { CardBadge } from '../components/CardBadge.js';
import { HandBuilderForm } from '../components/HandBuilderForm.js';
import { createHand, deleteHand, fetchHands } from '../services/apiClient.js';
import { forgetHand, rememberHand } from '../services/handOwnership.js';
import { navigate } from '../router.js';

const e = React.createElement;

const STREET_LABELS = Object.freeze({ preflop: 'preflop', flop: 'flop', turn: 'turn', river: 'river' });

/** @param {string} iso @returns {string} */
function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function HandLoggerPage() {
  const [hands, setHands] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [showForm, setShowForm] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const page = await fetchHands({ limit: 50 });
      setHands(page.items);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(hand) {
    const created = await createHand(hand);
    // Remembering the id here is what keeps the edit and delete controls on
    // the hand for its author while a shared link opens read-only.
    rememberHand(created.id);
    navigate(`/hands/${created.id}`);
  }

  async function handleDelete(id) {
    try {
      await deleteHand(id);
      forgetHand(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (showForm) {
    return e(
      'div',
      { className: 'hero-card' },
      e('h1', null, 'Log a hand'),
      e('p', { className: 'small' }, 'Set the table, deal the streets, and note what you were thinking. Everything else is worked out for you.'),
      e(HandBuilderForm, {
        initialValue: createEmptyHand({ seatCount: 6 }),
        submitLabel: 'Save hand',
        onSubmit: handleCreate,
        onCancel: () => setShowForm(false)
      })
    );
  }

  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, 'Hand Logger'),
    e('p', { className: 'small' }, 'Recreate a hand you played, note your thinking street by street, and keep a link to it.'),

    e('button', { type: 'button', onClick: () => setShowForm(true) }, '+ Log a hand'),

    error ? e('p', { className: 'footnote range-notation-error' }, error) : null,

    isLoading
      ? e('p', { className: 'footnote' }, 'Loading hands...')
      : hands.length === 0
        ? e('p', { className: 'footnote' }, 'No hands logged yet.')
        : e(
            'ul',
            { className: 'tournament-list' },
            hands.map(hand =>
              e(
                'li',
                { key: hand.id, className: 'tournament-list-item' },
                e(
                  'button',
                  { type: 'button', className: 'tournament-list-open', onClick: () => navigate(`/hands/${hand.id}`) },
                  e(
                    'span',
                    { className: 'tournament-list-name' },
                    hand.name,
                    e(
                      'span',
                      { className: 'hand-list-cards' },
                      hand.heroCards.filter(Boolean).map(card => e(CardBadge, { key: card, card }))
                    )
                  ),
                  e('span', { className: 'footnote' },
                    `${hand.gameType} · ${hand.seatCount}-handed · to the ${STREET_LABELS[hand.furthestStreet]} · pot ${hand.totalPot.toLocaleString()} · ${formatWhen(hand.updatedAt || hand.createdAt)}`)
                ),
                e('button', {
                  type: 'button',
                  className: 'ghost-button danger',
                  onClick: () => handleDelete(hand.id),
                  'aria-label': `Delete ${hand.name}`
                }, '×')
              )
            )
          )
  );
}
