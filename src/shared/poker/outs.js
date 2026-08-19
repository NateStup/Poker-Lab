/**
 * Outs: exactly which unseen cards improve a player to the winner (or a tie)
 * on the very next card dealt.
 *
 * Unlike `equity.js`, this never needs to sample -- there are at most 46
 * unseen cards on the flop (45 on the turn), so every one of them is simply
 * dealt and evaluated. That keeps the answer exact rather than an estimate,
 * which matters here: "you have 9 outs" is a precise claim players act on,
 * not a probability band.
 *
 * Scoped to heads-up (two players) with an incomplete board (flop or turn).
 * "Outs" is a per-opponent concept -- with three or more players a card can
 * help one opponent while hurting another, so there's no single meaningful
 * out count per player without picking which opponents it must beat, which is
 * exactly the ambiguity `calculateEquity`'s sampling sidesteps by reporting a
 * probability instead. Heads-up avoids that ambiguity entirely.
 *
 * Pure and isomorphic, like the rest of `shared/`.
 */

import { createDeck, removeCards } from './cards.js';
import { evaluateHand, findWinners } from './handEvaluator.js';

/**
 * @param {object} options
 * @param {string[][]} options.players exactly two hole-card pairs
 * @param {string[]} options.board 3 (flop) or 4 (turn) known community cards
 * @returns {{
 *   unseenCount: number,
 *   players: Array<{
 *     index: number,
 *     winCards: string[],
 *     tieCards: string[],
 *     outs: number,
 *     winOuts: number,
 *     tieOuts: number,
 *     percent: number
 *   }>
 * }}
 * @throws {TypeError} if there aren't exactly two players or the board isn't
 *   a flop or a turn
 */
export function calculateOuts({ players, board = [] } = {}) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new TypeError('calculateOuts requires exactly two players');
  }

  const knownBoard = (board || []).filter(Boolean);
  if (knownBoard.length !== 3 && knownBoard.length !== 4) {
    throw new TypeError('calculateOuts requires a flop (3 cards) or turn (4 cards) board');
  }

  const unseen = removeCards(createDeck(), [...players.flat(), ...knownBoard]);
  const tallies = players.map(() => ({ winCards: [], tieCards: [] }));

  for (const card of unseen) {
    const runoutBoard = [...knownBoard, card];
    const scores = players.map(hole => evaluateHand([...hole, ...runoutBoard]));
    const winners = findWinners(scores);
    const isSplit = winners.length > 1;

    for (const winnerIndex of winners) {
      (isSplit ? tallies[winnerIndex].tieCards : tallies[winnerIndex].winCards).push(card);
    }
  }

  return {
    unseenCount: unseen.length,
    players: tallies.map((tally, index) => ({
      index,
      winCards: tally.winCards,
      tieCards: tally.tieCards,
      outs: tally.winCards.length + tally.tieCards.length,
      winOuts: tally.winCards.length,
      tieOuts: tally.tieCards.length,
      percent: (tally.winCards.length + tally.tieCards.length) / unseen.length
    }))
  };
}
