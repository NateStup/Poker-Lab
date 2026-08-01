// Simple poker hand evaluator for 5-7 card hands
// Returns a comparable score array: [category, ...kickers] where higher is better

const RANK_ORDER = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14};

function rankCounts(cards) {
  const counts = {};
  for (const c of cards) {
    const r = c[0];
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

function suitCounts(cards) {
  const counts = {};
  for (const c of cards) {
    const s = c[1];
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

function uniqueRanksSorted(cards) {
  const set = new Set(cards.map(c => RANK_ORDER[c[0]]));
  const arr = Array.from(set).sort((a,b)=>b-a);
  return arr;
}

function isStraight(ranksDesc) {
  // ranksDesc is array of unique ranks sorted desc
  // handle wheel A-2-3-4-5
  const ranks = ranksDesc.slice().sort((a,b)=>a-b);
  // create string of present ranks
  const present = new Set(ranks);
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let r = 0; r < 5; r++) {
      const rank = high - r;
      const check = rank;
      // wheel case
      const toCheck = (check === 14) ? 14 : check;
      if (!present.has(toCheck)) {
        ok = false; break;
      }
    }
    if (ok) return high;
  }
  // wheel special: A,2,3,4,5
  if (present.has(14) && present.has(2) && present.has(3) && present.has(4) && present.has(5)) return 5;
  return null;
}

export function evaluate(cards) {
  // cards: array like ['As','Kd',...]
  // returns score array
  const counts = rankCounts(cards);
  const suits = suitCounts(cards);
  const ranksUniqueDesc = uniqueRanksSorted(cards);

  // check flush
  let flushSuit = null;
  for (const s in suits) if (suits[s] >= 5) flushSuit = s;

  // check straight
  const straightHigh = isStraight(ranksUniqueDesc);

  // check straight flush / royal
  if (flushSuit) {
    const flushCards = cards.filter(c=>c[1]===flushSuit);
    const flushRanks = uniqueRanksSorted(flushCards);
    const sfHigh = isStraight(flushRanks);
    if (sfHigh) return [8, sfHigh]; // 8 = straight flush
  }

  // counts analysis
  const groups = Object.entries(counts).map(([r,c])=>({rank:RANK_ORDER[r],count:c}));
  groups.sort((a,b)=>{ if (b.count!==a.count) return b.count-a.count; return b.rank-b.rank;});

  const byCount = {};
  for (const g of groups) {
    byCount[g.count] = byCount[g.count] || [];
    byCount[g.count].push(g.rank);
  }

  // four of a kind
  if (byCount[4]) {
    const quad = Math.max(...byCount[4]);
    const kickers = Object.keys(counts).map(r=>RANK_ORDER[r]).filter(r=>r!==quad).sort((a,b)=>b-a);
    return [7, quad, ...kickers];
  }

  // full house
  if (byCount[3] && (byCount[2] || byCount[3].length > 1)) {
    const trips = Math.max(...byCount[3]);
    const pair = byCount[3].length>1 ? Math.min(...byCount[3].filter(r=>r!==trips)) : Math.max(...(byCount[2]||[]));
    return [6, trips, pair];
  }

  // flush
  if (flushSuit) {
    const flushCards = cards.filter(c=>c[1]===flushSuit).map(c=>RANK_ORDER[c[0]]).sort((a,b)=>b-a).slice(0,5);
    return [5, ...flushCards];
  }

  // straight
  if (straightHigh) return [4, straightHigh];

  // three of a kind
  if (byCount[3]) {
    const trips = Math.max(...byCount[3]);
    const kickers = Object.keys(counts).map(r=>RANK_ORDER[r]).filter(r=>r!==trips).sort((a,b)=>b-a).slice(0,2);
    return [3, trips, ...kickers];
  }

  // two pair
  if (byCount[2] && byCount[2].length >=2) {
    const pairs = byCount[2].slice().sort((a,b)=>b-a);
    const top = pairs[0], second = pairs[1];
    const kicker = Object.keys(counts).map(r=>RANK_ORDER[r]).filter(r=>r!==top && r!==second).sort((a,b)=>b-a)[0];
    return [2, top, second, kicker];
  }

  // one pair
  if (byCount[2]) {
    const pair = Math.max(...byCount[2]);
    const kickers = Object.keys(counts).map(r=>RANK_ORDER[r]).filter(r=>r!==pair).sort((a,b)=>b-a).slice(0,3);
    return [1, pair, ...kickers];
  }

  // high card
  const highCards = Object.keys(counts).map(r=>RANK_ORDER[r]).sort((a,b)=>b-a).slice(0,5);
  return [0, ...highCards];
}

export function compare(aCards, bCards) {
  const a = evaluate(aCards);
  const b = evaluate(bCards);
  for (let i=0;i<Math.max(a.length,b.length);i++) {
    const av = a[i]||0; const bv = b[i]||0;
    if (av>bv) return 1;
    if (av<bv) return -1;
  }
  return 0;
}
