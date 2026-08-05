/**
 * Terminal error handling for the API.
 *
 * Two rules drive the shape of this module:
 *   1. Every API response is JSON, including failures. The frontend is a
 *      client-side app; an HTML error page would be unparseable to it.
 *   2. Only {@link ApiError} carries a client-safe message. Anything else is an
 *      unexpected fault: it is logged in full server-side and reported as a
 *      generic 500, so stack traces and internal paths never reach the client
 *      in production.
 */

import { ApiError } from '../errors/ApiError.js';
import { isDevelopment } from '../config.js';

/**
 * Convert unmatched routes into a 404 that flows through {@link errorHandler}.
 * @type {import('express').RequestHandler}
 */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Cannot ${req.method} ${req.originalUrl}`));
}

/**
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }

  // A bad JSON body surfaces from body-parser as a SyntaxError with a status.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json(
      ApiError.badRequest('Request body is not valid JSON.').toJSON()
    );
  }

  console.error('[error] unhandled failure:', err);

  const body = {
    error: {
      message: 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR'
    }
  };

  // Detail is a debugging aid locally and an information leak in production.
  if (isDevelopment()) {
    body.error.message = err.message || body.error.message;
    body.error.stack = err.stack;
  }

  res.status(err.status || 500).json(body);
}
