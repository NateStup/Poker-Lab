export const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const SUITS = ['s','h','d','c'];

export function createDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  return deck;
}

export function removeCards(deck, cardsToRemove) {
  const set = new Set(cardsToRemove);
  return deck.filter(c => !set.has(c));
}

export function drawRandom(deck, n) {
  const copy = deck.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export function parseHand(text) {
  if (!text) return [];
  return text.split(/\s+/).map(s => s.trim()).filter(Boolean);
}
