const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function buildBoard({ flop = [], turn = [] } = {}) {
  const board = [];
  for (const card of [...flop, ...turn]) {
    if (card) board.push(card);
  }
  return board.slice(0, 5);
}

function normalizeCards(cards) {
  return (cards || []).filter(Boolean);
}

function rankValue(rank) {
  return { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }[rank];
}

function evaluateHand(cards) {
  const normalized = normalizeCards(cards);
  const rankCounts = {};
  const suitCounts = {};
  const cardList = normalized.map(card => ({ card, rank: card[0], suit: card[1], value: rankValue(card[0]) }));

  for (const item of cardList) {
    rankCounts[item.rank] = (rankCounts[item.rank] || 0) + 1;
    suitCounts[item.suit] = (suitCounts[item.suit] || 0) + 1;
  }

  const straight = getStraight(cardList.map(item => item.value));
  const flush = Object.values(suitCounts).some(count => count >= 5);
  const handType = (() => {
    if (flush && straight) return 8;
    if (Object.values(rankCounts).includes(4)) return 7;
    if (Object.values(rankCounts).includes(3) && Object.values(rankCounts).includes(2)) return 6;
    if (flush) return 5;
    if (straight) return 4;
    if (Object.values(rankCounts).includes(3)) return 3;
    if (Object.values(rankCounts).filter(count => count === 2).length === 2) return 2;
    if (Object.values(rankCounts).includes(2)) return 1;
    return 0;
  })();

  const bestFive = getBestFiveCards(cardList, handType, straight, flush);
  return { handType, kickers: bestFive.map(item => item.value) };
}

function getStraight(values) {
  const unique = Array.from(new Set(values)).sort((a, b) => b - a);
  if (unique.includes(14) && unique.includes(5)) {
    const wheel = [5, 4, 3, 2, 1];
    if (wheel.every(value => unique.includes(value))) return 5;
  }
  for (let i = 0; i <= unique.length - 5; i++) {
    const subset = unique.slice(i, i + 5);
    if (subset[0] - subset[4] === 4) {
      return subset[0];
    }
  }
  return null;
}

function getBestFiveCards(cardList, handType, straight, flush) {
  const byRank = Object.values(cardList.reduce((acc, item) => {
    if (!acc[item.rank]) acc[item.rank] = [];
    acc[item.rank].push(item);
    return acc;
  }, {}));

  byRank.sort((a, b) => b.length - a.length || b[0].value - a[0].value);

  if (handType === 8 || handType === 5 || handType === 4) {
    const flushSuit = flush ? Object.entries(cardList.reduce((acc, item) => {
      acc[item.suit] = (acc[item.suit] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1])[0][0] : null;
    const candidates = flushSuit ? cardList.filter(item => item.suit === flushSuit) : cardList;
    const sorted = candidates.slice().sort((a, b) => b.value - a.value);
    if (handType === 4 && straight) {
      return sorted.filter(item => item.value >= straight - 4 && item.value <= straight).slice(0, 5);
    }
    return sorted.slice(0, 5);
  }

  if (handType === 7 || handType === 6 || handType === 3 || handType === 2 || handType === 1) {
    const selected = [];
    for (const group of byRank) {
      selected.push(...group.slice(0, 1));
      if (selected.length >= 5) break;
    }
    const remaining = cardList.filter(item => !selected.includes(item)).sort((a, b) => b.value - a.value);
    return [...selected, ...remaining].slice(0, 5);
  }

  return cardList.slice().sort((a, b) => b.value - a.value).slice(0, 5);
}

function compareHandRankings(a, b) {
  if (a.handType !== b.handType) return a.handType > b.handType ? 1 : -1;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    if ((a.kickers[i] || 0) !== (b.kickers[i] || 0)) {
      return (a.kickers[i] || 0) > (b.kickers[i] || 0) ? 1 : -1;
    }
  }
  return 0;
}

module.exports = {
  RANKS,
  SUITS,
  createDeck,
  buildBoard,
  evaluateHand,
  compareHandRankings
};
