import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { startServer, type RunningServer } from '../index.ts';

export interface TestServer extends RunningServer {
  dataDir: string;
  /** Stops the server and deletes its data unless `keepData` is set (to restart on the same data). */
  stop(options?: { keepData?: boolean }): Promise<void>;
}

export async function startTestServer(dataDir = mkdtempSync(join(tmpdir(), 'titodocs-test-'))): Promise<TestServer> {
  const running = await startServer({ config: { port: 0, host: '127.0.0.1', dataDir }, frontend: 'none' });
  return {
    ...running,
    dataDir,
    async stop({ keepData = false } = {}) {
      await running.close();
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A signed-in API client with its own cookie jar. */
export class Client {
  cookie = '';
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, data: data as any };
  }

  get = (path: string) => this.request('GET', path);
  post = (path: string, body: unknown = {}) => this.request('POST', path, body);
  patch = (path: string, body: unknown) => this.request('PATCH', path, body);
  put = (path: string, body: unknown) => this.request('PUT', path, body);
  delete = (path: string) => this.request('DELETE', path);

  static async register(baseUrl: string, username: string): Promise<Client> {
    const client = new Client(baseUrl);
    const { status, data } = await client.post('/api/auth/register', {
      username,
      password: 'correct horse battery',
      displayName: username[0].toUpperCase() + username.slice(1),
    });
    if (status !== 201) throw new Error(`register failed: ${JSON.stringify(data)}`);
    return client;
  }
}

/** Opens a collaboration connection as the given client (cookies are sent like a browser would). */
export function connect(server: RunningServer, client: Client, name: string, origin?: string) {
  const cookie = client.cookie;
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie, ...(origin ? { origin } : {}) } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({
    url: server.url.replace('http', 'ws') + '/collab',
    WebSocketPolyfill: CookieWebSocket,
    maxAttempts: 1,
  });
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document });
  provider.attach();
  const synced = new Promise<void>((resolve, reject) => {
    provider.on('synced', () => resolve());
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
  });
  return {
    provider,
    document,
    synced,
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };
}

export const waitFor = async (check: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
