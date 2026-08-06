/**
 * One saved hand at `/hands/:id` -- the page a shared link opens.
 *
 * It fetches by id on mount rather than reading anything the list page left
 * behind, which is the whole point: a link pasted to someone else has no
 * in-app state to inherit, so the cold load has to be the normal path, not a
 * fallback.
 */

import { HandBuilderForm } from '../components/HandBuilderForm.js';
import { HandSummary } from '../components/HandSummary.js';
import { deleteHand, fetchHand, updateHand } from '../services/apiClient.js';
import { Link, navigate } from '../router.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string} props.id
 */
export function HandDetailPage({ id }) {
  const [hand, setHand] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

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
    const url = `${window.location.origin}/hands/${id}`;
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

  return e(
    'div',
    { className: 'hero-card' },
    e(
      'div',
      { className: 'tournament-header' },
      e('div', null,
        e('h1', null, hand.name),
        e('p', { className: 'small' }, `${hand.format.gameType} · saved ${new Date(hand.createdAt).toLocaleDateString()}`)
      ),
      e(
        'div',
        { className: 'form-actions' },
        e(Link, { to: '/hands', className: 'ghost-button' }, 'All hands'),
        e('button', { type: 'button', className: 'ghost-button', onClick: copyLink }, copied ? 'Link copied' : 'Copy link'),
        e('button', { type: 'button', className: 'ghost-button', onClick: () => setIsEditing(true) }, 'Edit'),
        e('button', { type: 'button', className: 'ghost-button danger', onClick: handleDelete }, 'Delete')
      )
    ),
    e(HandSummary, { hand })
  );
}
