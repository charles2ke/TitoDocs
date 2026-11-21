import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { CODE_FIELD, THREADS_FIELD, commentsDocName } from '../../shared/types.ts';
import { Client, connect, startTestServer, waitFor, type TestServer } from './helpers.ts';

let server: TestServer;
let alice: Client;
let bob: Client;

before(async () => {
  server = await startTestServer();
  alice = await Client.register(server.url, 'alice');
  bob = await Client.register(server.url, 'bob');
});

after(async () => {
  await server.stop();
});

const newFile = async (type: string, title?: string) => (await alice.post('/api/files', { type, title })).data.file;

/** Resolves with the HTTP status the server answered a WebSocket upgrade with. */
const upgradeStatus = (headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(server.url.replace('http', 'ws') + '/collab', { headers });
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    socket.on('open', () => {
      socket.close();
      resolve(101);
    });
    socket.on('error', reject);
  });

describe('collaboration', () => {
  it('refuses connections without a session or from another site', async () => {
    assert.equal(await upgradeStatus({}), 401);
    assert.equal(await upgradeStatus({ cookie: alice.cookie, origin: 'https://evil.example' }), 403);
    assert.equal(await upgradeStatus({ cookie: alice.cookie, origin: server.url }), 101);
  });

  it('syncs edits live, persists them and indexes their text for search', async () => {
    const file = await newFile('code', 'notes.md');
    await alice.post(`/api/files/${file.id}/members`, { username: 'bob', role: 'editor' });
    const a = connect(server, alice, file.id);
    const b = connect(server, bob, file.id);
    await Promise.all([a.synced, b.synced]);

    a.document.getText(CODE_FIELD).insert(0, 'hello zebra world');
    await waitFor(() => b.document.getText(CODE_FIELD).toString() === 'hello zebra world');
    a.destroy();
    b.destroy();

    await waitFor(async () => (await bob.get('/api/files?q=zebra')).data.files.length === 1, 10_000);
    const [result] = (await bob.get('/api/files?q=zebra')).data.files;
    assert.equal(result.id, file.id);
    assert.match(result.snippet, /zebra/);
    assert.equal(result.updatedByName, 'Alice');

    await server.stop({ keepData: true });
    server = await startTestServer(server.dataDir);
    alice.baseUrl = bob.baseUrl = server.url;
    const reloaded = connect(server, alice, file.id);
    await reloaded.synced;
    assert.equal(reloaded.document.getText(CODE_FIELD).toString(), 'hello zebra world');
    reloaded.destroy();
  });

  it('ignores edits from viewers and lets commenters write comments only', async () => {
    const file = await newFile('code');
    await alice.post(`/api/files/${file.id}/members`, { username: 'bob', role: 'commenter' });
    const a = connect(server, alice, file.id);
    const b = connect(server, bob, file.id);
    const bComments = connect(server, bob, commentsDocName(file.id));
    const aComments = connect(server, alice, commentsDocName(file.id));
    await Promise.all([a.synced, b.synced, aComments.synced, bComments.synced]);
    assert.equal(b.provider.authorizedScope, 'readonly');
    assert.equal(bComments.provider.authorizedScope, 'read-write');

    b.document.getText(CODE_FIELD).insert(0, 'vandalism');
    bComments.document.getMap(THREADS_FIELD).set('t1', 'Looks good');
    await waitFor(() => aComments.document.getMap(THREADS_FIELD).get('t1') === 'Looks good');
    a.document.getText(CODE_FIELD).insert(0, 'legit');
    await waitFor(() => b.document.getText(CODE_FIELD).toString().includes('legit'));
    assert.equal(a.document.getText(CODE_FIELD).toString(), 'legit');
    const serverCopy = new Y.Doc();
    Y.applyUpdate(serverCopy, server.collab.getState(file.id)!);
    assert.equal(serverCopy.getText(CODE_FIELD).toString(), 'legit');

    for (const connection of [a, b, aComments, bComments]) connection.destroy();
  });

  it('denies documents the user cannot access', async () => {
    const file = await newFile('doc');
    const b = connect(server, bob, file.id);
    await assert.rejects(b.synced);
    b.destroy();
    const unknown = connect(server, bob, 'does-not-exist');
    await assert.rejects(unknown.synced);
    unknown.destroy();
  });

  it('notifies connected clients about renames and deletion', async () => {
    const file = await newFile('doc', 'Before');
    const a = connect(server, alice, file.id);
    await a.synced;
    const messages: { type: string; file?: { title: string } }[] = [];
    a.provider.on('stateless', ({ payload }: { payload: string }) => messages.push(JSON.parse(payload)));

    await alice.patch(`/api/files/${file.id}`, { title: 'After' });
    await waitFor(() => messages.some((message) => message.type === 'meta' && message.file?.title === 'After'));
    await alice.post(`/api/files/${file.id}/trash`);
    await waitFor(() => messages.some((message) => message.type === 'deleted'));
    a.destroy();
  });
});
