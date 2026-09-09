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

const unauthorizedListeners = new Set();

/**
 * Subscribe to "a request just came back 401." `AuthContext` is the reader;
 * this module is the one place that sees every request, so it's the one
 * place that can notice a session ending regardless of which page's call
 * triggered it -- the same shape `router.js` uses for navigation listeners.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
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

    // Every 401 notifies, including one from a login attempt with the wrong
    // password. That needs no special case: nobody was logged in to log out
    // of, so `AuthContext` is already anonymous and the notification lands
    // on nothing. Telling "was already logged out" from "just got logged
    // out" is the listener's business, not this module's.
    if (response.status === 401) {
      for (const listener of unauthorizedListeners) listener();
    }

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
 * Save a logged hand.
 * @param {object} payload see `validateHandLogRequest`
 * @returns {Promise<object>} the saved hand, decorated with `derived`
 */
export function createHand(payload) {
  return request('/api/hands', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Fetch a page of saved hands, newest first (lightweight summaries only).
 * @param {{limit?: number, offset?: number}} [query]
 * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
 */
export function fetchHands({ limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request(`/api/hands?${params}`);
}

/**
 * Fetch one saved hand, decorated with derived pot maths.
 * @param {string} id
 * @returns {Promise<object>}
 */
export function fetchHand(id) {
  return request(`/api/hands/${encodeURIComponent(id)}`);
}

/**
 * Edit a saved hand. The patch is merged over the stored record server-side,
 * so a partial edit is safe.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export function updateHand(id, patch) {
  return request(`/api/hands/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/**
 * Delete a saved hand.
 * @param {string} id
 * @returns {Promise<null>}
 */
export function deleteHand(id) {
  return request(`/api/hands/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Generate (or replace) a hand's share link.
 * @param {string} id
 * @returns {Promise<object>} the hand, decorated, including the new `shareToken`
 */
export function shareHand(id) {
  return request(`/api/hands/${encodeURIComponent(id)}/share`, { method: 'POST' });
}

/**
 * Revoke a hand's share link, leaving the hand itself untouched.
 * @param {string} id
 * @returns {Promise<null>}
 */
export function unshareHand(id) {
  return request(`/api/hands/${encodeURIComponent(id)}/share`, { method: 'DELETE' });
}

/**
 * Fetch a shared hand by its token. Public -- no session required, and
 * ownership is meaningless here since the whole point is that this works for
 * someone who isn't the owner.
 * @param {string} token
 * @returns {Promise<object>} the hand, decorated, with no `shareToken` in it
 */
export function fetchSharedHand(token) {
  return request(`/api/shared-hands/${encodeURIComponent(token)}`);
}

/**
 * Create an account and start a session.
 * @param {{email: string, password: string, displayName: string}} payload
 * @returns {Promise<{user: object}>}
 */
export function signup(payload) {
  return request('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * @param {{email: string, password: string}} credentials
 * @returns {Promise<{user: object}>}
 */
export function login(credentials) {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
}

/** @returns {Promise<null>} */
export function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

/**
 * The currently logged-in user, or a rejected promise if there isn't one.
 * @returns {Promise<{user: object}>}
 */
export function fetchCurrentUser() {
  return request('/api/auth/me');
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
 * Unconditionally the caller's own -- there is no "browse everyone's" mode
 * any more, and this 401s with no session.
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
 * Update settings (name, stacks, buy-in, blind structure, payout split).
 * Full settings are only accepted while the tournament is still in `setup`;
 * a payout-split-only patch is also accepted once registration has closed.
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
 * Claim an unowned tournament permanently for the caller. Requires a
 * session; there is no anonymous or "soft" version of this action.
 * @param {string} id
 * @returns {Promise<object>} the tournament, decorated, now carrying a `userId`
 */
export function saveTournament(id) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/save`, { method: 'POST' });
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
 * Close or reopen registration.
 * @param {string} id
 * @param {'close'|'reopen'} action
 * @returns {Promise<object>}
 */
export function updateTournamentRegistration(id, action) {
  return request(`/api/tournaments/${encodeURIComponent(id)}/registration`, {
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
