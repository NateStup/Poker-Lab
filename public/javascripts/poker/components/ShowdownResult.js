/**
 * What was shown down: each hand that got there, named in full, and who won.
 *
 * The evaluation is the shared `evaluateHand`/`describeHand` -- the same
 * evaluator the odds calculator scores runouts with -- so "Two pair, kings and
 * queens" here and a showdown in the calculator can't disagree. It is also the
 * same reading that awards the pot (`determineWinners`), so the hand named
 * here and the seat paid on the felt are one decision, not two.
 */

import { PlayingCard } from './PlayingCard.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {object[]} props.seats the hand's seats, for names
 * @param {string[]} props.positions
 * @param {object} props.showdown from `evaluateShowdown`
 */
export function ShowdownResult({ seats, positions, showdown }) {
  const winners = showdown.winningSeats.map(seatNumber => seats[seatNumber].name);
  const winningHand = showdown.seats.find(entry => entry.isWinner);

  return e(
    'div',
    { className: 'showdown-result' },
    e(
      'div',
      { className: 'range-panel-head' },
      e('h3', null, 'Showdown'),
      e(
        'span',
        { className: 'showdown-verdict' },
        winners.length === 1
          ? `${winners[0]} wins with ${winningHand.description.toLowerCase()}`
          : `${winners.join(' and ')} chop with ${winningHand.description.toLowerCase()}`
      )
    ),
    e(
      'ul',
      { className: 'showdown-list' },
      showdown.seats.map(entry =>
        e(
          'li',
          { key: entry.seatNumber, className: `showdown-row ${entry.isWinner ? 'is-winner' : ''}` },
          e('span', { className: 'hand-action-seat' }, positions[entry.seatNumber]),
          e('span', { className: 'hand-action-name' }, seats[entry.seatNumber].name),
          e('span', { className: 'playing-card-row' },
            entry.cards.map(card => e(PlayingCard, { key: card, card, size: 'sm' }))),
          e('span', { className: 'showdown-hand' }, entry.description)
        )
      )
    )
  );
}
