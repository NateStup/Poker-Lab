/**
 * Thin wrapper around the JSON API.
 *
 * Every network call in the client goes through here so error handling is
 * consistent: the server always answers with `{ error: { message, details } }`
 * on failure, and this module turns that into a real `Error` with the
 * field-level details attached. Components then only ever handle exceptions,
 * never raw responses.
 */

/** Error carrying the server's structured failure detail. */
export class ApiRequestError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, details?: string[]}} [info]
   */
  constructor(message, { status, code, details = [] } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Perform a JSON request and unwrap the response.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} parsed body, or `null` for a 204
 * @throws {ApiRequestError}
 */
async function request(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
  } catch (cause) {
    // fetch only rejects on a transport failure, never on an HTTP error status.
    throw new ApiRequestError('Could not reach the server. Is it running?', { code: 'NETWORK_ERROR' });
  }

  if (response.status === 204) return null;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = body?.error || {};
    throw new ApiRequestError(error.message || `Request failed with status ${response.status}`, {
      status: response.status,
      code: error.code,
      details: error.details || []
    });
  }

  return body;
}

/**
 * Calculate equity for a spot.
 * @param {{players: string[][], board?: string[], dead?: string[], iterations?: number, seed?: number|string, label?: string}} payload
 * @returns {Promise<object>}
 */
export function calculateEquity(payload) {
  return request('/api/equity', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Calculate equity for a hero range against a specific hand or another range.
 * @param {{heroRange: string[], villain: {cards: string[]}|{hands: string[]},
 *   board?: string[], dead?: string[], iterations?: number, seed?: number|string}} payload
 * @returns {Promise<object>}
 */
export function calculateRangeEquity(payload) {
  return request('/api/ranges/equity', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Fetch a page of calculation history, newest first.
 * @param {{limit?: number, offset?: number, type?: string}} [query]
 * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
 */
export function fetchHistory({ limit = 10, offset = 0, type } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (type) params.set('type', type);
  return request(`/api/history?${params}`);
}

/**
 * Delete a single history record.
 * @param {string} id
 * @returns {Promise<null>}
 */
export function deleteHistoryRecord(id) {
  return request(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Delete every history record.
 * @returns {Promise<{removed: number}>}
 */
export function clearHistory() {
  return request('/api/history', { method: 'DELETE' });
}

/**
 * Create a tournament.
 * @param {object} payload see `validateCreateTournamentRequest`
 * @returns {Promise<object>}
 */
export function createTournament(payload) {
  return request('/api/tournaments', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Fetch a page of tournaments, newest first (lightweight summaries only).
 * @param {{limit?: number, offset?: number}} [query]
 * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
 */
export function fetchTournaments({ limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request(`/api/tournaments?${params}`);
}

/**
 * Fetch one tournament, decorated with derived clock/stats/payouts.
 * @param {string} id
 * @returns {Promise<object>}
 */
export function fetchTournament(id) {
  return request(`/api/tournaments/${encodeURIComponent(id)}`);
}

/**
 * Update settings (name, stacks, buy-in, blind structure, payout split) --
 * only accepted while the tournament is still in `setup`.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export function updateTournamentSettings(id, patch) {
  return request(`/api/tournaments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/**
 * Delete a tournament.
 * @param {string} id
 * @returns {Promise<null>}
 */
export function deleteTournament(id) {
  return request(`/api/tournaments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Reset a tournament back to `setup` -- clock to level 0, every player's
 * eliminations/rebuys/add-ons cleared, roster kept.
 * @param {string} id
 * @returns {Promise<object>}
 */
export function resetTournament(id) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/reset`, { method: 'POST' });
}

/**
 * Register a player.
 * @param {string} id
 * @param {string} name
 * @returns {Promise<object>}
 */
export function registerTournamentPlayer(id, name) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/players`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

/**
 * Remove a registered player (setup-only; eliminate instead once the
 * tournament has started).
 * @param {string} id
 * @param {string} playerId
 * @returns {Promise<object>}
 */
export function removeTournamentPlayer(id, playerId) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}`, {
    method: 'DELETE'
  });
}

/**
 * Apply a player action: rebuy, add-on, eliminate, or reinstate.
 * @param {string} id
 * @param {string} playerId
 * @param {'rebuy'|'addon'|'eliminate'|'reinstate'} action
 * @returns {Promise<object>}
 */
export function updateTournamentPlayer(id, playerId, action) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action })
  });
}

/**
 * Apply a clock action: start, pause, resume, advance, or setLevel.
 * @param {string} id
 * @param {'start'|'pause'|'resume'|'advance'|'setLevel'} action
 * @param {number} [levelIndex] required for `'setLevel'`
 * @returns {Promise<object>}
 */
export function updateTournamentClock(id, action, levelIndex) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/clock`, {
    method: 'PATCH',
    body: JSON.stringify({ action, levelIndex })
  });
}
