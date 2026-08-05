/**
 * Standard range-shorthand import/export for a `RangeGrid` selection.
 *
 * Every serious range tool (PokerStove, Equilab, Flopzilla, GTO charts) reads
 * and writes this notation (`'22+,A5s+,KTo+'`), which is what makes a range
 * built here portable -- paste one in from elsewhere, or copy one out to
 * share. Parsing is lenient (invalid tokens are reported, not fatal) since a
 * pasted range often comes from a source with slightly different casing or a
 * typo.
 */

import { formatRangeString, parseRangeString } from '/shared/poker/rangeNotation.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {Set<string>} props.hands the range currently selected on the grid
 * @param {(hands: string[]) => void} props.onApply called with the parsed
 *   hand codes when the user applies a pasted range
 */
export function RangeNotation({ hands, onApply }) {
  const [draft, setDraft] = React.useState('');
  const [message, setMessage] = React.useState(null);
  const notation = React.useMemo(() => formatRangeString(hands), [hands]);

  function copyNotation() {
    navigator.clipboard?.writeText(notation)
      .then(() => setMessage({ tone: 'ok', text: 'Copied.' }))
      .catch(() => setMessage({ tone: 'error', text: 'Could not copy -- select and copy the text manually.' }));
  }

  function applyDraft() {
    const { hands: parsed, errors } = parseRangeString(draft);

    if (parsed.length === 0) {
      setMessage({ tone: 'error', text: errors.length ? errors.join(' ') : 'Nothing to apply.' });
      return;
    }

    onApply(parsed);
    setMessage(
      errors.length
        ? { tone: 'error', text: `Applied; skipped: ${errors.join(' ')}` }
        : { tone: 'ok', text: `Applied ${parsed.length} hand${parsed.length === 1 ? '' : 's'}.` }
    );
  }

  return e(
    'div',
    { className: 'range-notation' },
    e(
      'div',
      { className: 'range-notation-current' },
      e('code', null, notation || '(no hands selected)'),
      e('button', { type: 'button', className: 'ghost-button', onClick: copyNotation }, 'Copy')
    ),
    e(
      'div',
      { className: 'range-notation-input-row' },
      e('input', {
        type: 'text',
        placeholder: 'Paste a range, e.g. 22+,A5s+,KTo+',
        value: draft,
        onChange: event => setDraft(event.target.value)
      }),
      e('button', { type: 'button', className: 'ghost-button', onClick: applyDraft }, 'Apply')
    ),
    message
      ? e('p', { className: `footnote ${message.tone === 'error' ? 'range-notation-error' : ''}` }, message.text)
      : null
  );
}
