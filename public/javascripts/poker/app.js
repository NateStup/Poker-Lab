import { parseHand } from './modules/deck.js';
import { calculateEquityOnServer } from './modules/serverCalculator.js';

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('poker-form');
  const results = document.getElementById('results');

  function showResult(obj) {
    if (!results) {
      return;
    }

    if (obj.error) {
      results.innerHTML = `
        <div class="result-card error-card">
          <h3>Calculation issue</h3>
          <p>${obj.error}</p>
        </div>
      `;
      return;
    }

    if (obj.status) {
      results.innerHTML = `
        <div class="result-card loading-card">
          <h3>${obj.status}</h3>
          <p>Waiting for the server to return the equity estimate.</p>
        </div>
      `;
      return;
    }

    results.innerHTML = `
      <div class="result-card summary-card">
        <h3>Equity Summary</h3>
        <div class="stat-grid">
          <div class="stat-box">
            <span class="stat-label">Player A</span>
            <strong>${obj.player1}</strong>
          </div>
          <div class="stat-box">
            <span class="stat-label">Player B</span>
            <strong>${obj.player2}</strong>
          </div>
          <div class="stat-box">
            <span class="stat-label">Tie</span>
            <strong>${obj.tie}</strong>
          </div>
        </div>
        <p class="footnote">Based on ${obj.iterations} simulations.</p>
        ${obj.board ? `<p class="footnote">Board: ${obj.board}</p>` : ''}
      </div>
    `;
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const p1txt = document.getElementById('p1').value;
    const p2txt = document.getElementById('p2').value;
    const flopTxt = document.getElementById('flop').value;
    const turnTxt = document.getElementById('turn').value;
    const iterations = parseInt(document.getElementById('iterations').value, 10) || 2000;

    const p1 = parseHand(p1txt);
    const p2 = parseHand(p2txt);
    const flop = parseHand(flopTxt);
    const turn = parseHand(turnTxt);

    if (p1.length !== 2 || p2.length !== 2) {
      showResult({ error: 'Please enter exactly two hole cards for each player.' });
      return;
    }

    showResult({ status: 'Sending request to server...' });

    try {
      const payload = {
        player1: p1,
        player2: p2,
        flop,
        turn,
        iterations
      };

      console.log('Submitting payload:', payload);

      const res = await calculateEquityOnServer(payload);

      showResult({
        player1: (res.player1 * 100).toFixed(2) + '%',
        player2: (res.player2 * 100).toFixed(2) + '%',
        tie: (res.tie * 100).toFixed(2) + '%',
        iterations,
        board: res.board,
        boardMode: res.boardMode
      });
    } catch (err) {
      showResult({ error: err.message || 'Calculation failed.' });
    }
  });
});
