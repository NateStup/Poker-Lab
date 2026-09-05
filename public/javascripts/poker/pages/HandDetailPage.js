/**
 * One saved hand at `/hands/:id` -- the owner's own view.
 *
 * There's exactly one mode now, unlike before: this route is gated by
 * `RequireAuth` and the API scopes every lookup to the caller's own hands,
 * so if this page renders at all, it's rendering the caller's hand. There is
 * no `?share=1` flag to read and no `handOwnership.js` to consult -- a hand
 * that isn't the caller's simply isn't found, which is what makes this page
 * safe to assume ownership throughout rather than check it.
 */

import { BackButton } from '../components/BackButton.js';
import { HandBuilderForm } from '../components/HandBuilderForm.js';
import { downloadHand, HandDetailView } from '../components/HandDetailView.js';
import { deleteHand, fetchHand, shareHand, unshareHand, updateHand } from '../services/apiClient.js';
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
  const [isSharing, setIsSharing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setHand(null);
    setError(null);

    fetchHand(id)
      .then(loaded => { if (!cancelled) setHand(loaded); })
      .catch(err => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [id]);

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

  async function handleShare() {
    setIsSharing(true);
    try {
      setHand(await shareHand(id));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSharing(false);
    }
  }

  async function handleUnshare() {
    setIsSharing(true);
    try {
      await unshareHand(id);
      // Not `setHand(await unshareHand(id))`: that call answers 204, so it
      // resolves to null, and handing null to `setHand` blanks a hand the
      // server still has. Revoking clears exactly one field and touches
      // nothing else (see `HandLogService.unshare`), so clearing it here is
      // the whole update -- no re-fetch needed to stay in step.
      setHand(current => ({ ...current, shareToken: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSharing(false);
    }
  }

  function copyShareLink() {
    const url = `${window.location.origin}/shared/${hand.shareToken}`;
    navigator.clipboard?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError('Could not copy the link to your clipboard.'));
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
    const { derived: _derived, shareToken: _shareToken, ...editable } = hand;

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

  const actions = e(
    React.Fragment,
    null,
    e(BackButton, { fallback: '/hands', label: 'Back to all hands' }),
    e('button', { type: 'button', className: 'ghost-button', onClick: () => downloadHand(hand) }, 'Download'),
    hand.shareToken
      ? e(
          React.Fragment,
          null,
          e('button', { type: 'button', className: 'ghost-button', onClick: copyShareLink }, copied ? 'Link copied' : 'Copy share link'),
          e('button', {
            type: 'button',
            className: 'ghost-button danger',
            onClick: handleUnshare,
            disabled: isSharing
          }, 'Revoke link')
        )
      : e('button', {
          type: 'button',
          className: 'ghost-button',
          onClick: handleShare,
          disabled: isSharing
        }, 'Get share link'),
    e('button', { type: 'button', className: 'ghost-button', onClick: () => setIsEditing(true) }, 'Edit'),
    e('button', { type: 'button', className: 'ghost-button danger', onClick: handleDelete }, 'Delete')
  );

  return e(HandDetailView, { hand, actions });
}
