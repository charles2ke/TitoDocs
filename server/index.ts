import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { createApp } from './app.ts';
import { createCollab, type Collab } from './collab.ts';
import { loadConfig, type Config } from './config.ts';
import { openDatabase, type DB } from './db.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface StartOptions {
  config?: Partial<Config>;
  /** How the web client is served: Vite dev middleware, the production build, or not at all (API tests). */
  frontend?: 'vite' | 'static' | 'none';
}

export interface RunningServer {
  url: string;
  port: number;
  db: DB;
  collab: Collab;
  close(): Promise<void>;
}

export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const config = loadConfig(options.config);
  const frontendMode = options.frontend ?? (config.production ? 'static' : 'vite');
  const db = openDatabase(config.dataDir);
  const collab = createCollab(db, config);
  const server = createServer();

  let vite: ViteDevServer | undefined;
  let frontend: ((app: Express) => void) | undefined;
  if (frontendMode === 'static') {
    const dist = join(ROOT, 'dist', 'client');
    if (!existsSync(join(dist, 'index.html'))) throw new Error('Client build not found. Run `npm run build` first.');
    frontend = (app) => {
      app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
      app.use(express.static(dist, { index: false }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        res.sendFile(join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
      });
    };
  } else if (frontendMode === 'vite') {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      configFile: join(ROOT, 'vite.config.ts'),
      root: join(ROOT, 'client'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    frontend = (app) => app.use(vite!.middlewares);
  }

  const app = createApp({ db, config, collab, frontend });
  server.on('request', app);
  collab.attach(server, { exclusive: frontendMode !== 'vite' });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      await collab.destroy();
      await vite?.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      db.close();
    })());

  return { url: `http://${host}:${port}`, port, db, collab, close };
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const running = await startServer();
  console.log(`TitoDocs is running at ${running.url}`);
  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
