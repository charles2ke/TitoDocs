import { Router } from 'express';
import type { Config } from '../config.ts';
import type { Collab } from '../collab.ts';
import type { DB } from '../db.ts';
import {
  HttpError,
  RateLimiter,
  badRequest,
  currentUser,
  endSession,
  forbidden,
  optionalString,
  requireAuth,
  requireString,
  startSession,
} from '../http.ts';
import { createUser, getUserById, getUserByUsername, toPublicUser } from '../models.ts';
import { hashPassword, hashToken, randomColor, verifyPassword } from '../security.ts';
import { parseCookies, SESSION_COOKIE } from '../http.ts';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function authRoutes(db: DB, config: Config, collab: Collab): Router {
  const router = Router();
  const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
  const loginAddressLimiter = new RateLimiter(30, 15 * 60 * 1000);
  const registerLimiter = new RateLimiter(20, 60 * 60 * 1000);

  router.get('/config', (_req, res) => {
    res.json({ allowRegistration: config.allowRegistration });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? toPublicUser(req.user) : null });
  });

  router.post('/register', async (req, res) => {
    if (!config.allowRegistration) throw forbidden('Registration is disabled on this server.');
    if (!registerLimiter.take(req.ip ?? 'unknown')) throw new HttpError(429, 'Too many sign-ups. Try again later.');
    const username = requireString(req.body?.username, 'Username', { min: 3, max: 32 });
    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest('Username may only contain letters, numbers, dots, dashes and underscores.');
    }
    const password = requireString(req.body?.password, 'Password', { min: 8, max: 200, trim: false });
    const displayName = optionalString(req.body?.displayName, 'Display name', 64) ?? username;
    if (getUserByUsername(db, username)) throw new HttpError(409, 'That username is already taken.');
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = createUser(db, { username, displayName, passwordHash, color: randomColor() });
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) throw new HttpError(409, 'That username is already taken.');
      throw error;
    }
    startSession(db, config, res, user.id);
    res.status(201).json({ user: toPublicUser(user) });
  });

  router.post('/login', async (req, res) => {
    const username = requireString(req.body?.username, 'Username', { max: 64 });
    const password = requireString(req.body?.password, 'Password', { max: 200, trim: false });
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (
      !loginAddressLimiter.take(req.ip ?? 'unknown') ||
      !loginLimiter.take(key)
    ) {
      throw new HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
    }
    const user = getUserByUsername(db, username);
    // Hash anyway for unknown users so response timing does not reveal which usernames exist.
    const valid = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
    if (!user || !valid) throw new HttpError(401, 'Incorrect username or password.');
    const latestUser = getUserById(db, user.id);
    if (!latestUser || latestUser.password_hash !== user.password_hash) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    loginLimiter.reset(key);
    startSession(db, config, res, latestUser.id);
    res.json({ user: toPublicUser(latestUser) });
  });

  router.post('/logout', (req, res) => {
    endSession(db, config, req, res, (tokenHash) => collab.closeSessions([tokenHash]));
    res.json({ ok: true });
  });

  router.patch('/me', requireAuth, (req, res) => {
    const user = currentUser(req);
    const displayName = optionalString(req.body?.displayName, 'Display name', 64);
    const color = req.body?.color;
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) {
      throw badRequest('Color must be a hex value like #1c7ed6.');
    }
    db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), color = COALESCE(?, color) WHERE id = ?').run(
      displayName ?? null,
      color ?? null,
      user.id,
    );
    res.json({ user: toPublicUser(getUserById(db, user.id)!) });
  });

  router.post('/password', requireAuth, async (req, res) => {
    const user = currentUser(req);
    const current = requireString(req.body?.currentPassword, 'Current password', { max: 200, trim: false });
    const next = requireString(req.body?.newPassword, 'New password', { min: 8, max: 200, trim: false });
    if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(401, 'Current password is incorrect.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), user.id);
    // Sign out every other session.
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const tokenHash = token ? hashToken(token) : '';
    const revoked = db
      .prepare('SELECT token_hash FROM sessions WHERE user_id = ? AND token_hash != ?')
      .all(user.id, tokenHash) as { token_hash: string }[];
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, tokenHash);
    collab.closeSessions(revoked.map((session) => session.token_hash));
    res.json({ ok: true });
  });

  return router;
}
