// Serves the production build on a throwaway data directory for the end-to-end tests (see playwright.config.ts).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'titodocs-e2e-'));
const running = await startServer({
  config: { port: Number(process.env.E2E_PORT ?? 4790), host: '127.0.0.1', dataDir, production: true },
  frontend: 'static',
});
console.log(`TitoDocs (e2e) is running at ${running.url}`);

const stop = async () => {
  await running.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
