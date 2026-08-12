/**
 * One saved hand at `/hands/:id` -- the page a shared link opens.
 *
 * It fetches by id on mount rather than reading anything the list page left
 * behind, which is the whole point: a link pasted to someone else has no
 * in-app state to inherit, so the cold load has to be the normal path, not a
 * fallback.
 *
 * The page has two modes. Its author (see `handOwnership.js` for what "author"
 * can mean without accounts) gets the replay, the full write-up, and the edit
 * and delete controls. Anyone opening a shared link gets a view-only page:
 * replay and write-up, nothing that changes the record. A shared hand is
 * something to study, and an Edit button on someone else's hand is at best a
 * mistake waiting to happen.
 */

import { derivePositions } from '/shared/handLog/index.js';
import { BackButton } from '../components/BackButton.js';
import { HandBuilderForm } from '../components/HandBuilderForm.js';
import { HandReplay } from '../components/HandReplay.js';
import { HandSummary } from '../components/HandSummary.js';
import { deleteHand, fetchHand, updateHand } from '../services/apiClient.js';
import { forgetHand, isMyHand } from '../services/handOwnership.js';
import { Link, navigate, useSearchParam } from '../router.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string} props.id
 */
export function HandDetailPage({ id }) {
  const [hand, setHand] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [tab, setTab] = React.useState('replay');
  const [copied, setCopied] = React.useState(false);

  // View-only is for the person a hand was *shared with*, and nobody else.
  // Two conditions have to line up for it: the link says it was shared (the
  // `?share=1` the copy-link button hands out), and this browser isn't the one
  // that logged the hand. So the author keeps editing on their own hand even
  // when they follow their own share link, and a hand opened from the list --
  // including one logged before this browser started tracking authorship --
  // is never locked.
  const isSharedLink = useSearchParam('share') !== null;
  const canEdit = !isSharedLink || isMyHand(id);

  React.useEffect(() => {
    let cancelled = false;
    setHand(null);
    setError(null);

    fetchHand(id)
      .then(loaded => { if (!cancelled) setHand(loaded); })
      .catch(err => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [id]);

  function copyLink() {
    const url = `${window.location.origin}/hands/${id}?share=1`;
    navigator.clipboard?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError('Could not copy the link to your clipboard.'));
  }

  async function handleSave(edited) {
    const saved = await updateHand(id, edited);
    setHand(saved);
    setIsEditing(false);
  }

  async function handleDelete() {
    try {
      await deleteHand(id);
      forgetHand(id);
      navigate('/hands');
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) {
    return e(
      'div',
      { className: 'hero-card' },
      e('div', { className: 'error-card' }, e('p', null, error)),
      e(Link, { to: '/hands', className: 'ghost-button' }, 'Back to all hands')
    );
  }

  if (!hand) {
    return e('div', { className: 'hero-card' }, e('p', { className: 'footnote' }, 'Loading hand...'));
  }

  if (isEditing) {
    // `derived` is a server-computed read model, not part of the hand -- the
    // form recomputes it live, so carrying the stale copy into the editor and
    // back up in the PATCH body would just be noise.
    const { derived: _derived, ...editable } = hand;

    return e(
      'div',
      { className: 'hero-card' },
      e('h1', null, `Editing: ${hand.name}`),
      e(HandBuilderForm, {
        initialValue: editable,
        submitLabel: 'Save changes',
        onSubmit: handleSave,
        onCancel: () => setIsEditing(false)
      })
    );
  }

  const positions = derivePositions(hand.seats.length, hand.buttonSeat);

  return e(
    'div',
    { className: 'hero-card' },
    e(
      'div',
      { className: 'tournament-header' },
      e('div', null,
        e('h1', null, hand.name),
        e('p', { className: 'small' },
          `${hand.format.gameType} · ${hand.seats.length}-handed · saved ${new Date(hand.createdAt).toLocaleDateString()}`),
        canEdit ? null : e('span', { className: 'hand-view-only-badge' }, 'Shared hand · view only')
      ),
      e(
        'div',
        { className: 'form-actions' },
        e(BackButton, { fallback: '/hands', label: 'Back to all hands' }),
        e('button', { type: 'button', className: 'ghost-button', onClick: copyLink },
          copied ? 'Link copied' : 'Copy share link'),
        canEdit
          ? e('button', { type: 'button', className: 'ghost-button', onClick: () => setIsEditing(true) }, 'Edit')
          : null,
        canEdit
          ? e('button', { type: 'button', className: 'ghost-button danger', onClick: handleDelete }, 'Delete')
          : null
      )
    ),

    e(
      'div',
      { className: 'hand-tabs' },
      e('button', {
        type: 'button',
        className: `ghost-button ${tab === 'replay' ? 'is-active' : ''}`,
        onClick: () => setTab('replay'),
        'aria-pressed': tab === 'replay'
      }, 'Replay'),
      e('button', {
        type: 'button',
        className: `ghost-button ${tab === 'summary' ? 'is-active' : ''}`,
        onClick: () => setTab('summary'),
        'aria-pressed': tab === 'summary'
      }, 'Full write-up')
    ),

    tab === 'replay'
      ? e(HandReplay, { hand, positions })
      : e(HandSummary, { hand })
  );
}
