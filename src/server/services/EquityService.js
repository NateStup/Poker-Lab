/**
 * Application service for equity calculations.
 *
 * Sits between the HTTP routes and the domain engine. Routes stay thin -- parse,
 * delegate, respond -- and the interesting logic (validation, persistence,
 * response shaping) is testable without spinning up Express.
 *
 * The repository is injected rather than imported so tests can supply a
 * throwaway store, and so a future queue-backed or database-backed store drops
 * in without touching this file.
 */

import { calculateEquity, validateEquityRequest } from '../../shared/poker/index.js';
import { ApiError } from '../errors/ApiError.js';

export class EquityService {
  /** @param {{historyRepository: import('../store/HistoryRepository.js').HistoryRepository}} deps */
  constructor({ historyRepository }) {
    this.historyRepository = historyRepository;
  }

  /**
   * Validate a request, run the engine, and record the outcome.
   *
   * @param {object} payload raw request body
   * @param {string|undefined} userId stamped as the record's owner if
   *   present, exactly like a tournament created while logged in -- an
   *   anonymous calculation stores `userId: null` and stays that way forever
   * @param {object} [options]
   * @param {boolean} [options.persist=true] set false to calculate without
   *   writing history (used by the upcoming simulator's inner loop)
   * @returns {Promise<object>} the engine result plus the history record id
   * @throws {ApiError} 400 when the payload fails validation
   */
  async calculate(payload, userId, { persist = true } = {}) {
    const { valid, errors, value } = validateEquityRequest(payload);

    if (!valid) {
      throw ApiError.badRequest('The equity request is invalid.', errors);
    }

    const result = calculateEquity(value);

    let historyId = null;
    if (persist) {
      // History is a convenience, not part of the answer. If the disk write
      // fails the caller still gets their numbers; the failure is logged.
      try {
        const record = await this.historyRepository.recordEquityCalculation({
          request: value,
          result,
          label: typeof payload.label === 'string' ? payload.label.slice(0, 120) : undefined,
          userId: userId || null
        });
        historyId = record.id;
      } catch (error) {
        console.error('[equity] failed to persist history record:', error.message);
      }
    }

    return { ...result, historyId };
  }
}
