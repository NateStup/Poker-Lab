import { parseHand } from './modules/deck.js';
import { calculateEquityOnServer } from './modules/serverCalculator.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = [
  { code: 's', symbol: '♠', label: 'Spades', className: 'suit-black' },
  { code: 'h', symbol: '♥', label: 'Hearts', className: 'suit-red' },
  { code: 'd', symbol: '♦', label: 'Diamonds', className: 'suit-red' },
  { code: 'c', symbol: '♣', label: 'Clubs', className: 'suit-black' }
];

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('poker-form');
  const results = document.getElementById('results');
  const picker = document.getElementById('card-picker');
  const targetButtons = Array.from(document.querySelectorAll('.picker-target'));
  const fieldIds = ['p1', 'p2', 'flop', 'turn'];
  let activeTarget = 'p1';

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

  function getFieldValue(fieldId) {
    const input = document.getElementById(fieldId);
    return input ? input.value : '';
  }

  function getSuitMeta(suitCode) {
    return SUITS.find(suit => suit.code === suitCode) || SUITS[0];
  }

  function renderCardBadge(cardCode) {
    const rank = cardCode[0];
    const suitCode = cardCode[1];
    const suitMeta = getSuitMeta(suitCode);

    return `<span class="card-chip ${suitMeta.className}"><span class="card-chip-rank">${rank}</span><span class="card-chip-suit">${suitMeta.symbol}</span></span>`;
  }

  function getAllSelectedCards() {
    return fieldIds.flatMap(fieldId => getSelectedCards(fieldId));
  }

  function setFieldValue(fieldId, value) {
    const input = document.getElementById(fieldId);
    if (!input) {
      return;
    }

    input.value = value;
    const preview = document.getElementById(`${fieldId}-preview`);
    if (preview) {
      const selected = value.split(/\s+/).filter(Boolean);
      preview.innerHTML = selected.length
        ? `<span class="card-preview-list">${selected.map(renderCardBadge).join('')}</span>`
        : '<span class="preview-placeholder">No cards selected</span>';
    }
  }

  function getSelectedCards(fieldId) {
    return getFieldValue(fieldId).split(/\s+/).filter(Boolean);
  }

  function toggleCardForActiveTarget(cardCode) {
    const selected = getSelectedCards(activeTarget);
    const cardIndex = selected.indexOf(cardCode);
    const allSelected = getAllSelectedCards();
    const isUsedElsewhere = allSelected.includes(cardCode) && !selected.includes(cardCode);

    if (cardIndex >= 0) {
      selected.splice(cardIndex, 1);
    } else if (isUsedElsewhere) {
      return;
    } else {
      const maxCards = parseInt(document.getElementById(activeTarget).dataset.maxCards || '99', 10);
      if (selected.length >= maxCards) {
        return;
      }
      selected.push(cardCode);
    }

    setFieldValue(activeTarget, selected.join(' '));
    updatePickerState();
  }

  function updatePickerState() {
    if (!picker) {
      return;
    }

    const buttons = Array.from(picker.querySelectorAll('.card-option'));
    const allSelected = getAllSelectedCards();

    buttons.forEach(button => {
      const cardCode = button.dataset.card;
      const selected = getSelectedCards(activeTarget);
      const isUsedElsewhere = allSelected.includes(cardCode) && !selected.includes(cardCode);
      button.classList.toggle('is-selected', selected.includes(cardCode));
      button.classList.toggle('is-used', isUsedElsewhere);
    });

    targetButtons.forEach(button => {
      const isActive = button.dataset.target === activeTarget;
      button.classList.toggle('is-active', isActive);
    });
  }

  function renderPicker() {
    if (!picker) {
      return;
    }

    const rows = SUITS.map(suit => {
      const buttons = RANKS.map(rank => {
        const cardCode = `${rank}${suit.code}`;
        return `<button type="button" class="card-option" data-card="${cardCode}" aria-label="${rank}${suit.symbol}">${renderCardBadge(cardCode)}</button>`;
      }).join('');

      return `<div class="picker-row" data-suit="${suit.code}"><span class="picker-row-label">${suit.symbol}</span>${buttons}</div>`;
    }).join('');

    picker.innerHTML = rows;
  }

  targetButtons.forEach(button => {
    button.addEventListener('click', function() {
      activeTarget = button.dataset.target;
      updatePickerState();
    });
  });

  if (picker) {
    picker.addEventListener('click', function(event) {
      const button = event.target.closest('.card-option');
      if (!button) {
        return;
      }

      toggleCardForActiveTarget(button.dataset.card);
    });
  }

  fieldIds.forEach(fieldId => {
    const input = document.getElementById(fieldId);
    if (input && !input.value) {
      setFieldValue(fieldId, '');
    }
  });

  renderPicker();
  updatePickerState();

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const p1txt = getFieldValue('p1');
    const p2txt = getFieldValue('p2');
    const flopTxt = getFieldValue('flop');
    const turnTxt = getFieldValue('turn');
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
