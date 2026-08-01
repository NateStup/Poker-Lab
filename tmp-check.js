const { evaluateHand, compareHandRankings } = require('./lib/poker');
const royal = evaluateHand(['Ah','Kh','Qh','Jh','Th','2d','3c']);
const pair = evaluateHand(['As','Ac','2d','3c','4h','5s','6s']);
console.log(JSON.stringify({ royal, pair, comparison: compareHandRankings(royal, pair) }));
