import { createDeck, removeCards, drawRandom } from './deck.js';
import { compare } from './evaluator.js';

export async function simulateEquity(p1, p2, iterations = 2000) {
  // p1 and p2 are arrays of hole cards e.g. ['As','Ks']
  let wins1 = 0, wins2 = 0, ties = 0;
  for (let i = 0; i < iterations; i++) {
    const deck = createDeck();
    const used = [...p1, ...p2];
    const deckRem = removeCards(deck, used);

    // draw 5 board cards
    const board = drawRandom(deckRem, 5);

    const hand1 = [...p1, ...board];
    const hand2 = [...p2, ...board];

    const cmp = compare(hand1, hand2);
    if (cmp > 0) wins1++;
    else if (cmp < 0) wins2++;
    else ties++;
  }

  const total = wins1 + wins2 + ties;
  return {
    player1: wins1 / total,
    player2: wins2 / total,
    tie: ties / total
  };
}
