/**
 * Tournament chip and money math.
 *
 * The organizer never types in a live chip count for every player -- that's
 * exactly the manual bookkeeping a tournament manager is supposed to remove.
 * Instead, every number here derives from just two kinds of event: an entry
 * (buy-in, rebuy, or add-on, each worth a fixed chip amount and a fixed
 * dollar amount) and an elimination. Total chips in play and the prize pool
 * are sums over entries; average stack is total chips divided by the players
 * still in.
 */

/**
 * @typedef {object} TournamentPlayer
 * @property {boolean} eliminated
 * @property {number} rebuys
 * @property {number} addOns
 */

/**
 * @param {TournamentPlayer[]} players
 * @returns {number} players not yet eliminated
 */
export function activePlayerCount(players) {
  return players.filter(player => !player.eliminated).length;
}

/**
 * @param {TournamentPlayer[]} players
 * @param {{startingStack: number, rebuyStack: number, addOnStack: number}} settings
 * @returns {number} total chips across every entry, regardless of elimination
 *   -- an eliminated player's chips don't leave the table, they went to
 *   whoever won them
 */
export function totalChipsInPlay(players, { startingStack, rebuyStack, addOnStack }) {
  return players.reduce(
    (sum, player) => sum + startingStack + player.rebuys * rebuyStack + player.addOns * addOnStack,
    0
  );
}

/**
 * @param {number} totalChips
 * @param {number} activeCount
 * @returns {number} 0 if nobody is left, to avoid a division by zero
 */
export function averageStack(totalChips, activeCount) {
  return activeCount > 0 ? totalChips / activeCount : 0;
}

/**
 * @param {TournamentPlayer[]} players
 * @param {{buyIn: number, rebuyAmount: number, addOnAmount: number}} settings
 * @returns {number} total money collected across every entry
 */
export function prizePool(players, { buyIn, rebuyAmount, addOnAmount }) {
  return players.reduce(
    (sum, player) => sum + buyIn + player.rebuys * rebuyAmount + player.addOns * addOnAmount,
    0
  );
}
