var express = require('express');
var router = express.Router();
var { buildBoard, evaluateHand, compareHandRankings } = require('../lib/poker');

// GET poker equity calculator page
router.get('/', function(req, res, next) {
  res.render('poker_equity', { title: 'Poker Equity Calculator' });
});

// POST poker equity calculator API
router.post('/api/poker/equity', function(req, res, next) {
  const { player1 = [], player2 = [], flop = [], turn = [], iterations = 2000 } = req.body || {};

  if (!Array.isArray(player1) || player1.length !== 2 || !Array.isArray(player2) || player2.length !== 2) {
    return res.status(400).json({ error: 'Please provide exactly two hole cards for each player.' });
  }

  if (!Array.isArray(flop) || flop.length > 3) {
    return res.status(400).json({ error: 'Flop must be an array with up to 3 cards.' });
  }

  if (!Array.isArray(turn) || turn.length > 1) {
    return res.status(400).json({ error: 'Turn must be an array with up to 1 card.' });
  }

  const count = Math.max(100, parseInt(iterations, 10) || 2000);
  let wins1 = 0;
  let wins2 = 0;
  let ties = 0;

  const fixedBoard = buildBoard({ flop, turn });
  const used = [...player1, ...player2, ...fixedBoard];

  for (let i = 0; i < count; i++) {
    const deck = [];
    const suits = ['s', 'h', 'd', 'c'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

    for (const rank of ranks) {
      for (const suit of suits) {
        deck.push(rank + suit);
      }
    }

    const available = deck.filter(card => !used.includes(card));

    const board = [...fixedBoard];
    while (board.length < 5) {
      const idx = Math.floor(Math.random() * available.length);
      board.push(available.splice(idx, 1)[0]);
    }

    const hand1 = [...player1, ...board];
    const hand2 = [...player2, ...board];

    const score1 = evaluateHand(hand1);
    const score2 = evaluateHand(hand2);

    const comparison = compareHandRankings(score1, score2);
    if (comparison > 0) {
      wins1++;
    } else if (comparison < 0) {
      wins2++;
    } else {
      ties++;
    }
  }

  res.json({
    player1: wins1 / count,
    player2: wins2 / count,
    tie: ties / count,
    board: fixedBoard.length ? fixedBoard.join(' ') : 'Random board',
    boardMode: fixedBoard.length ? 'custom texture' : 'random board'
  });
});

// Export the router so it can be mounted in app.js
module.exports = router;
