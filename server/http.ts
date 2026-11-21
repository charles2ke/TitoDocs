import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { hashToken, newSessionToken } from './security.ts';
import { getUserById, type UserRow } from './models.ts';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

export const SESSION_COOKIE = 'titodocs_session';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, message);
export const forbidden = (message = 'You do not have permission to do that.'): HttpError => new HttpError(403, message);
export const notFound = (message = 'Not found.'): HttpError => new HttpError(404, message);

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function userFromCookieHeader(db: DB, cookieHeader: string | undefined): UserRow | undefined {
  return sessionFromCookieHeader(db, cookieHeader)?.user;
}

export function sessionFromCookieHeader(
  db: DB,
  cookieHeader: string | undefined,
): { user: UserRow; tokenHash: string } | undefined {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; expires_at: number } | undefined;
  if (!session || session.expires_at < Date.now()) return undefined;
  const user = getUserById(db, session.user_id);
  return user ? { user, tokenHash } : undefined;
}

export function startSession(db: DB, config: Config, res: Response, userId: string): void {
  const token = newSessionToken();
  const now = Date.now();
  const maxAge = config.sessionDays * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    now + maxAge,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge,
    path: '/',
  });
}

export function endSession(
  db: DB,
  config: Config,
  req: Request,
  res: Response,
  onRevoke?: (tokenHash: string) => void,
): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const tokenHash = hashToken(token);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    onRevoke?.(tokenHash);
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' });
}

export const authenticate =
  (db: DB): RequestHandler =>
  (req, _res, next) => {
    req.user = userFromCookieHeader(db, req.headers.cookie);
    next();
  };

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
};

export function currentUser(req: Request): UserRow {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
}

/**
 * Same-origin check used for state-changing requests and WebSocket upgrades. Requests without an
 * Origin header (non-browser clients) are allowed: they cannot ride on a victim's cookies.
 */
export function isAllowedOrigin(headers: IncomingHttpHeaders, config: Config): boolean {
  const origin = headers.origin;
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwardedHost = config.trustProxy ? headers['x-forwarded-host'] : undefined;
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(',')[0].trim() ?? headers.host;
  return !!host && originHost === host;
}

export const originGuard =
  (config: Config): RequestHandler =>
  (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!isAllowedOrigin(req.headers, config)) return next(forbidden('Cross-origin request blocked.'));
    next();
  };

/** Simple fixed-window limiter keyed by an arbitrary string (used for login attempts). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;
  private limit: number;
  private windowMs: number;
  private maxEntries: number;
  private cleanupEvery: number;

  constructor(limit: number, windowMs: number, maxEntries = 10_000, cleanupEvery = 256) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.cleanupEvery = cleanupEvery;
  }

  /** Returns false once `key` has exceeded the limit within the current window. */
  take(key: string): boolean {
    const now = Date.now();
    if (++this.calls % this.cleanupEvery === 0) {
      for (const [k, v] of this.hits) if (v.resetAt < now) this.hits.delete(k);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      if (!entry && this.hits.size >= this.maxEntries) {
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

// ---------------------------------------------------------------- input validation

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 500, trim = true }: { min?: number; max?: number; trim?: boolean } = {},
): string {
  if (typeof value !== 'string') throw badRequest(`${field} is required.`);
  const result = trim ? value.trim() : value;
  if (result.length < min) throw badRequest(min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`);
  if (result.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return result;
}

export function optionalString(value: unknown, field: string, max = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return requireString(value, field, { max });
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: (error as Error).message || 'Bad request.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong.' });
};
