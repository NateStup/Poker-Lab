/**
 * Errors the API deliberately surfaces to clients.
 *
 * Anything thrown that is *not* an `ApiError` is treated by the error handler
 * as an unexpected fault: it is logged in full and reported to the client as a
 * generic 500, so internal details never leak through an accidental throw.
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message client-safe message
   * @param {object} [options]
   * @param {string[]} [options.details] field-level problems, e.g. validation errors
   * @param {string} [options.code] stable machine-readable identifier
   */
  constructor(status, message, { details = [], code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code || defaultCodeFor(status);
    // Keep the constructor itself out of the stack trace.
    Error.captureStackTrace?.(this, ApiError);
  }

  /** @returns {{error: {message: string, code: string, details?: string[]}}} */
  toJSON() {
    const body = { message: this.message, code: this.code };
    if (this.details.length > 0) body.details = this.details;
    return { error: body };
  }

  /**
   * 400 -- the request was malformed or failed validation.
   * @param {string} message
   * @param {string[]} [details]
   */
  static badRequest(message, details = []) {
    return new ApiError(400, message, { details, code: 'BAD_REQUEST' });
  }

  /**
   * 404 -- the addressed resource does not exist.
   * @param {string} [message]
   */
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, { code: 'NOT_FOUND' });
  }

  /**
   * 422 -- syntactically valid but semantically impossible.
   * @param {string} message
   * @param {string[]} [details]
   */
  static unprocessable(message, details = []) {
    return new ApiError(422, message, { details, code: 'UNPROCESSABLE' });
  }
}

/**
 * @param {number} status
 * @returns {string}
 */
function defaultCodeFor(status) {
  if (status >= 500) return 'INTERNAL_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) return 'BAD_REQUEST';
  return 'ERROR';
}
