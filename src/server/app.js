/**
 * Express application assembly.
 *
 * Exported as a factory rather than a ready-made app so tests can build an
 * isolated instance with their own store. Nothing here binds a port -- that is
 * `server.js`'s job, which keeps the app itself trivially testable with
 * supertest or a one-off `http.createServer(app)`.
 */

import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';
import morgan from 'morgan';

import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createApiRouter } from './routes/index.js';
import { EquityService } from './services/EquityService.js';
import { HandLogService } from './services/HandLogService.js';
import { RangeService } from './services/RangeService.js';
import { TournamentService } from './services/TournamentService.js';
import { createHandLogRepository, createHistoryRepository, createTournamentRepository } from './store/index.js';

/**
 * Build a fully wired Express app.
 *
 * @param {object} [options]
 * @param {import('./store/HistoryRepository.js').HistoryRepository} [options.historyRepository]
 *   inject a repository (tests pass one backed by a temp directory); a
 *   configured one is created when omitted
 * @param {import('./store/TournamentRepository.js').TournamentRepository} [options.tournamentRepository]
 *   same, for tournaments
 * @param {import('./store/HandLogRepository.js').HandLogRepository} [options.handLogRepository]
 *   same, for saved hands
 * @returns {Promise<import('express').Express>} the app, with its repositories on
 *   `locals` so callers can close the stores on shutdown
 */
export async function createApp({ historyRepository, tournamentRepository, handLogRepository } = {}) {
  const repository = historyRepository || await createHistoryRepository();
  const tournamentRepo = tournamentRepository || await createTournamentRepository();
  const handLogRepo = handLogRepository || await createHandLogRepository();
  const equityService = new EquityService({ historyRepository: repository });
  const rangeService = new RangeService();
  const tournamentService = new TournamentService({ tournamentRepository: tournamentRepo });
  const handLogService = new HandLogService({ handLogRepository: handLogRepo });

  const app = express();

  app.set('port', config.port);
  // Trust the reverse proxy's forwarded headers when deployed behind one.
  app.set('trust proxy', config.env === 'production');

  app.use(morgan(config.logging.format));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // The browser imports the poker domain straight from source. Serving
  // `src/shared` is what lets the client and server share one implementation
  // with no build step and no duplicated logic.
  app.use('/shared', express.static(config.paths.shared, {
    extensions: ['js'],
    setHeaders(res) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    }
  }));

  app.use(express.static(config.paths.public));

  app.use('/api', createApiRouter({
    equityService,
    rangeService,
    tournamentService,
    handLogService,
    historyRepository: repository
  }));

  // Any non-API path falls through to the single-page app, so client-side
  // routing works on a hard refresh. API 404s are still real 404s.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(config.paths.public, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.historyRepository = repository;
  app.locals.tournamentRepository = tournamentRepo;
  app.locals.handLogRepository = handLogRepo;

  return app;
}
