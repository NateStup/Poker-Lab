/**
 * Express 4 does not forward rejected promises from async route handlers, so an
 * `await` that throws becomes an unhandled rejection and the request hangs until
 * it times out. Wrapping a handler here routes any rejection to `next()` and
 * therefore to the error middleware.
 *
 * (Express 5 handles this natively; the wrapper is harmless there and can be
 * dropped when the project upgrades.)
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
