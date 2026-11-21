import express, { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import { HttpError, badRequest, currentUser, notFound, requireAuth } from '../http.ts';
import { searchUsers } from '../models.ts';
import { newId } from '../security.ts';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const UPLOAD_NAME = /^[A-Za-z0-9_-]{16,64}\.(png|jpg|gif|webp)$/;

/** Detects the image type from magic bytes; the client-supplied Content-Type is never trusted. */
export function sniffImage(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  const head = data.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function uploadRoutes(db: DB, config: Config): { api: Router; files: Router } {
  const directory = join(config.dataDir, 'uploads');
  mkdirSync(directory, { recursive: true });

  const api = Router();
  api.post('/', requireAuth, express.raw({ type: () => true, limit: config.maxUploadBytes }), async (req, res) => {
    const user = currentUser(req);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The upload is empty.');
    const mime = sniffImage(body);
    if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images can be uploaded.');
    const id = newId();
    const name = `${id}.${EXTENSIONS[mime]}`;
    await writeFile(join(directory, name), body);
    db.prepare('INSERT INTO uploads (id, owner_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      user.id,
      mime,
      body.length,
      Date.now(),
    );
    res.status(201).json({ url: `/uploads/${name}` });
  });

  const files = Router();
  files.get('/:name', requireAuth, (req, res, next) => {
    const name = String(req.params.name);
    if (!UPLOAD_NAME.test(name)) return next(notFound());
    res.sendFile(join(directory, name), {
      maxAge: '365d',
      immutable: true,
      headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" },
    }, (error) => {
      if (error && !res.headersSent) next(notFound());
    });
  });

  return { api, files };
}

export function userRoutes(db: DB): Router {
  const router = Router();
  router.get('/', requireAuth, (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
    res.json({ users: searchUsers(db, query, 10) });
  });
  return router;
}
