/**
 * Application service for range-vs-hand and range-vs-range equity.
 *
 * Mirrors {@link ./EquityService.js}: routes stay thin, validation and error
 * shaping happen here. Unlike a single-spot calculation, a range result is not
 * persisted to history -- there is no `RECORD_TYPES` entry for it, and a
 * sampled range result is far less meaningful to "replay" than a concrete
 * hand's seed, since the sampled combos themselves aren't recorded.
 */

import { calculateRangeEquity, validateRangeEquityRequest } from '../../shared/poker/index.js';
import { ApiError } from '../errors/ApiError.js';

export class RangeService {
  /**
   * Validate a request and run the range-equity engine.
   *
   * @param {object} payload raw request body
   * @returns {Promise<object>} the engine result
   * @throws {ApiError} 400 when the payload fails validation, or 422 when the
   *   ranges leave no legal combo pairing once blocked cards are removed
   */
  async calculateEquity(payload) {
    const { valid, errors, value } = validateRangeEquityRequest(payload);

    if (!valid) {
      throw ApiError.badRequest('The range equity request is invalid.', errors);
    }

    try {
      return calculateRangeEquity(value);
    } catch (error) {
      if (error instanceof RangeError) {
        throw ApiError.unprocessable(error.message);
      }
      throw error;
    }
  }
}
