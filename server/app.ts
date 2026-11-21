import express, { type Express, type RequestHandler } from 'express';
import type { Collab } from './collab.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { authenticate, errorHandler, notFound, originGuard } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import { fileRoutes } from './routes/files.ts';
import { uploadRoutes, userRoutes } from './routes/misc.ts';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders =
  (config: Config): RequestHandler =>
  (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (config.production) res.setHeader('Content-Security-Policy', PRODUCTION_CSP);
    next();
  };

export interface AppOptions {
  db: DB;
  config: Config;
  collab: Collab;
  /** Registers the web client (Vite dev middleware or static files) after the API routes. */
  frontend?: (app: Express) => void;
}

export function createApp({ db, config, collab, frontend }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders(config));
  app.use(authenticate(db));

  const uploads = uploadRoutes(db, config);
  app.use('/api', originGuard(config));
  app.use('/api/uploads', uploads.api);
  app.use('/api', express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes(db, config));
  app.use('/api/files', fileRoutes(db, collab));
  app.use('/api/users', userRoutes(db));
  app.use('/api', (_req, _res, next) => next(notFound()));
  app.use('/uploads', uploads.files);

  frontend?.(app);
  app.use(errorHandler);
  return app;
}
