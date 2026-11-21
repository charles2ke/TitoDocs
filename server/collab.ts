import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hocuspocus, type WebSocketLike } from '@hocuspocus/server';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Config } from './config.ts';
import { transaction, type DB } from './db.ts';
import { isAllowedOrigin, sessionFromCookieHeader } from './http.ts';
import {
  createVersion,
  getFile,
  getRole,
  getStoredState,
  pruneAutoVersions,
  storeState,
  toPublicUser,
  type FileRow,
} from './models.ts';
import { extractText } from './text.ts';
import { canComment, canEdit, commentsDocName, type PublicUser, type StatelessMessage } from '../shared/types.ts';

export interface CollabContext {
  user: PublicUser;
  sessionHash: string;
}

const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

/** Hocuspocus logs hook errors that have a message; expected denials are not worth logging. */
const denied = (reason: string): Error => Object.assign(new Error(), { reason });

export function parseDocName(name: string): { fileId: string; kind: 'content' | 'comments' } | null {
  const [fileId, suffix, ...rest] = name.split(':');
  if (!fileId || rest.length) return null;
  if (suffix === undefined) return { fileId, kind: 'content' };
  if (suffix === 'comments') return { fileId, kind: 'comments' };
  return null;
}

/** Whether someone may open one of a file's collaboration documents, and if so whether only to read it. */
function documentAccess(db: DB, userId: string, file: FileRow, kind: 'content' | 'comments'): { readOnly: boolean } | null {
  const role = getRole(db, userId, file);
  if (!role) return null;
  // Workspace documents only carry presence and server notifications.
  if (file.trashed_at || file.type === 'workspace') return { readOnly: true };
  return { readOnly: kind === 'comments' ? !canComment(role) : !canEdit(role) };
}

export interface Collab {
  hocuspocus: Hocuspocus<CollabContext>;
  /** Latest state of a collaboration document (live in-memory state when loaded). */
  getState(name: string): Uint8Array | null;
  broadcast(fileId: string, message: StatelessMessage): void;
  /** Disconnects every client from a file's documents (after deletion or trashing). */
  closeFile(fileId: string): void;
  /** Disconnects every collaboration socket authenticated with one of these sessions. */
  closeSessions(tokenHashes: string[]): void;
  /**
   * Applies sharing changes (and trashing) to everyone connected to these files: roles change in place, people who lost
   * access are disconnected, and every client re-checks the files.
   */
  refreshAccess(fileIds: string[]): void;
  /** Handles WebSocket upgrades on `/collab`. With `exclusive`, other upgrade requests are refused. */
  attach(server: HttpServer, options: { exclusive: boolean }): void;
  destroy(): Promise<void>;
}

export function createCollab(db: DB, config: Config): Collab {
  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'titodocs',
    quiet: true,
    debounce: 1500,
    maxDebounce: 8000,

    async onAuthenticate({ documentName, context, connectionConfig }) {
      const parsed = parseDocName(documentName);
      const file = parsed && getFile(db, parsed.fileId);
      const access = parsed && file && context.user ? documentAccess(db, context.user.id, file, parsed.kind) : null;
      if (!access) throw denied('forbidden');
      connectionConfig.readOnly = access.readOnly;
    },

    async onLoadDocument({ documentName }) {
      const parsed = parseDocName(documentName);
      if (!parsed || !getFile(db, parsed.fileId)) throw denied('not-found');
      return getStoredState(db, documentName);
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const parsed = parseDocName(documentName);
      const file = parsed && getFile(db, parsed.fileId);
      if (!parsed || !file) return;
      const state = Y.encodeStateAsUpdate(document);
      const now = Date.now();
      const userId = (lastContext as CollabContext | undefined)?.user?.id ?? null;
      transaction(db, () => {
        storeState(db, documentName, file.id, state);
        if (parsed.kind !== 'content' || file.type === 'workspace') return;
        db.prepare('UPDATE files SET updated_at = ?, updated_by = COALESCE(?, updated_by), text_content = ? WHERE id = ?').run(
          now,
          userId,
          extractText(document, file.type),
          file.id,
        );
        const last = db.prepare('SELECT MAX(created_at) AS at FROM versions WHERE file_id = ?').get(file.id) as {
          at: number | null;
        };
        if (last.at === null || now - last.at >= AUTO_VERSION_INTERVAL_MS) {
          createVersion(db, file.id, state, { auto: true, userId });
          pruneAutoVersions(db, file.id);
        }
      });
    },
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  const sessionSockets = new Map<string, Set<WebSocket>>();

  const handleSocket = (ws: WebSocket, req: IncomingMessage, user: PublicUser, sessionHash: string): void => {
    const headers = new Headers();
    for (const name of ['origin', 'user-agent']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const request = new Request(new URL(req.url ?? '/', 'http://localhost'), { headers });
    const connection = hocuspocus.handleConnection(ws as unknown as WebSocketLike, request, { user, sessionHash });
    const sockets = sessionSockets.get(sessionHash) ?? new Set<WebSocket>();
    sockets.add(ws);
    sessionSockets.set(sessionHash, sockets);
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, HEARTBEAT_MS);
    ws.on('message', (data: RawData) => connection.handleMessage(toUint8Array(data)));
    ws.on('pong', () => connection.touch());
    ws.on('error', (error) => console.warn('collab socket error:', error.message));
    ws.on('close', (code, reason) => {
      clearInterval(heartbeat);
      sockets.delete(ws);
      if (sockets.size === 0) sessionSockets.delete(sessionHash);
      connection.handleClose({ code, reason: reason.toString() });
    });
  };

  return {
    hocuspocus,

    getState(name) {
      const live = hocuspocus.documents.get(name);
      if (live) return Y.encodeStateAsUpdate(live);
      return getStoredState(db, name) ?? null;
    },

    broadcast(fileId, message) {
      hocuspocus.documents.get(fileId)?.broadcastStateless(JSON.stringify(message));
    },

    closeFile(fileId) {
      this.broadcast(fileId, { type: 'access' });
      hocuspocus.closeConnections(fileId);
      hocuspocus.closeConnections(commentsDocName(fileId));
    },

    closeSessions(tokenHashes) {
      for (const tokenHash of tokenHashes) {
        for (const socket of sessionSockets.get(tokenHash) ?? []) socket.terminate();
      }
    },

    refreshAccess(fileIds) {
      for (const fileId of fileIds) {
        const file = getFile(db, fileId);
        this.broadcast(fileId, { type: 'access' });
        for (const kind of ['content', 'comments'] as const) {
          const name = kind === 'content' ? fileId : commentsDocName(fileId);
          for (const connection of hocuspocus.documents.get(name)?.getConnections() ?? []) {
            const access = file && documentAccess(db, (connection.context as CollabContext).user.id, file, kind);
            // Hocuspocus checks `readOnly` for every incoming update, so a new role applies without reconnecting.
            if (access) connection.readOnly = access.readOnly;
            else connection.close();
          }
        }
      }
    },

    attach(server, { exclusive }) {
      server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const { pathname } = new URL(req.url ?? '/', 'http://localhost');
        if (pathname !== '/collab') {
          if (exclusive) socket.destroy();
          return;
        }
        if (!isAllowedOrigin(req.headers, config)) return rejectUpgrade(socket, 403, 'Forbidden');
        const session = sessionFromCookieHeader(db, req.headers.cookie);
        if (!session) return rejectUpgrade(socket, 401, 'Unauthorized');
        wss.handleUpgrade(req, socket, head, (ws) =>
          handleSocket(ws, req, toPublicUser(session.user), session.tokenHash),
        );
      });
    },

    async destroy() {
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
      const deadline = Date.now() + 5000;
      while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Closing the server does not close open sockets, and the HTTP server waits for them.
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
