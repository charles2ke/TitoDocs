import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MessageType, type HocuspocusProvider } from '@hocuspocus/provider';
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

/** Who is connected to a document on the server, and with which access. */
const connections = (name: string): Record<string, 'read' | 'write'> =>
  Object.fromEntries(
    (server.collab.hocuspocus.documents.get(name)?.getConnections() ?? []).map((connection) => [
      connection.context.user.username,
      connection.readOnly ? 'read' : 'write',
    ]),
  );

const serverText = (name: string) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, server.collab.getState(name)!);
  return copy.getText(CODE_FIELD).toString();
};

/** Records the server's replies to a client's updates: whether each one was applied. */
const updateReplies = (provider: HocuspocusProvider) => {
  const replies: boolean[] = [];
  provider.on('message', ({ message }: { message: { readVarString(): string; readVarUint(): number } }) => {
    message.readVarString();
    if (message.readVarUint() === MessageType.SyncStatus) replies.push(message.readVarUint() === 1);
  });
  return replies;
};

/** Collects the types of the server's notifications to a client. */
const notices = (provider: HocuspocusProvider) => {
  const types: string[] = [];
  provider.on('stateless', ({ payload }: { payload: string }) => types.push(JSON.parse(payload).type));
  return types;
};

const memberId = (members: { user: { id: string; username: string } }[], username: string) =>
  members.find((member) => member.user.username === username)!.user.id;

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
    await waitFor(() => messages.some((message) => message.type === 'access'));
    a.destroy();
  });

  it('applies role changes to open connections at once', async () => {
    const file = await newFile('code');
    const { data } = await alice.post(`/api/files/${file.id}/members`, { username: 'bob', role: 'viewer' });
    const bobId = memberId(data.members, 'bob');
    const a = connect(server, alice, file.id);
    const b = connect(server, bob, file.id);
    await Promise.all([a.synced, b.synced]);
    const replies = updateReplies(b.provider);
    const bobNotices = notices(b.provider);
    assert.deepEqual(connections(file.id), { alice: 'write', bob: 'read' });

    await alice.patch(`/api/files/${file.id}/members/${bobId}`, { role: 'editor' });
    assert.deepEqual(connections(file.id), { alice: 'write', bob: 'write' });
    await waitFor(() => bobNotices.includes('access'));
    b.document.getText(CODE_FIELD).insert(0, 'bob ');
    await waitFor(() => a.document.getText(CODE_FIELD).toString() === 'bob ');

    await alice.patch(`/api/files/${file.id}/members/${bobId}`, { role: 'viewer' });
    assert.deepEqual(connections(file.id), { alice: 'write', bob: 'read' });
    b.document.getText(CODE_FIELD).insert(0, 'ignored ');
    await waitFor(() => replies.includes(false));
    // Still connected: Bob keeps receiving edits.
    a.document.getText(CODE_FIELD).insert(4, 'and alice');
    await waitFor(() => b.document.getText(CODE_FIELD).toString().endsWith('and alice'));
    assert.equal(serverText(file.id), 'bob and alice');

    a.destroy();
    b.destroy();
  });

  it('disconnects people who lose access', async () => {
    const file = await newFile('doc');
    await alice.put(`/api/files/${file.id}/sharing`, { linkAccess: 'edit' });
    const a = connect(server, alice, file.id);
    const viaLink = connect(server, bob, file.id);
    const viaLinkComments = connect(server, bob, commentsDocName(file.id));
    await Promise.all([a.synced, viaLink.synced, viaLinkComments.synced]);
    const bobNotices = notices(viaLink.provider);

    await alice.put(`/api/files/${file.id}/sharing`, { linkAccess: 'none' });
    assert.deepEqual(connections(file.id), { alice: 'write' });
    assert.deepEqual(connections(commentsDocName(file.id)), {});
    await waitFor(() => bobNotices.includes('access') && !viaLink.provider.isAuthenticated);
    viaLink.destroy();
    viaLinkComments.destroy();

    const { data } = await alice.post(`/api/files/${file.id}/members`, { username: 'bob', role: 'commenter' });
    const member = connect(server, bob, file.id);
    await member.synced;
    assert.deepEqual(connections(file.id), { alice: 'write', bob: 'read' });
    await alice.delete(`/api/files/${file.id}/members/${memberId(data.members, 'bob')}`);
    assert.deepEqual(connections(file.id), { alice: 'write' });

    a.destroy();
    member.destroy();
  });

  it('disconnects the session socket on logout', async () => {
    const file = await newFile('code');
    const logoutDevice = new Client(server.url);
    await logoutDevice.post('/api/auth/login', { username: 'alice', password: 'correct horse battery' });
    const ownerConnection = connect(server, alice, file.id);
    const revokedConnection = connect(server, logoutDevice, file.id);
    await Promise.all([ownerConnection.synced, revokedConnection.synced]);
    assert.equal(server.collab.hocuspocus.documents.get(file.id)?.getConnections().length, 2);

    await logoutDevice.post('/api/auth/logout');
    await waitFor(() => server.collab.hocuspocus.documents.get(file.id)?.getConnections().length === 1);
    revokedConnection.document.getText(CODE_FIELD).insert(0, 'revoked');
    ownerConnection.document.getText(CODE_FIELD).insert(0, 'active');
    await waitFor(() => serverText(file.id) === 'active');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(revokedConnection.document.getText(CODE_FIELD).toString(), 'revoked');

    ownerConnection.destroy();
    revokedConnection.destroy();
  });

  it('disconnects other-session sockets when the password changes', async () => {
    const file = await newFile('code');
    const otherDevice = new Client(server.url);
    await otherDevice.post('/api/auth/login', { username: 'alice', password: 'correct horse battery' });
    const ownerConnection = connect(server, alice, file.id);
    const revokedConnection = connect(server, otherDevice, file.id);
    await Promise.all([ownerConnection.synced, revokedConnection.synced]);
    assert.equal(server.collab.hocuspocus.documents.get(file.id)?.getConnections().length, 2);

    const changed = await alice.post('/api/auth/password', {
      currentPassword: 'correct horse battery',
      newPassword: 'even better horse',
    });
    assert.equal(changed.status, 200);
    await waitFor(() => server.collab.hocuspocus.documents.get(file.id)?.getConnections().length === 1);
    revokedConnection.document.getText(CODE_FIELD).insert(0, 'revoked');
    ownerConnection.document.getText(CODE_FIELD).insert(0, 'active');
    await waitFor(() => serverText(file.id) === 'active');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(revokedConnection.document.getText(CODE_FIELD).toString(), 'revoked');

    ownerConnection.destroy();
    revokedConnection.destroy();
  });

  it('keeps trashed files open read-only to the owner only, until restored', async () => {
    const file = await newFile('code');
    await alice.post(`/api/files/${file.id}/members`, { username: 'bob', role: 'editor' });
    const a = connect(server, alice, file.id);
    const b = connect(server, bob, file.id);
    await Promise.all([a.synced, b.synced]);

    await alice.post(`/api/files/${file.id}/trash`);
    assert.deepEqual(connections(file.id), { alice: 'read' });
    await alice.post(`/api/files/${file.id}/restore`);
    assert.deepEqual(connections(file.id), { alice: 'write' });
    a.document.getText(CODE_FIELD).insert(0, 'restored');
    await waitFor(() => serverText(file.id) === 'restored');

    a.destroy();
    b.destroy();
  });

  it('applies workspace sharing and trashing to its pages', async () => {
    const workspace = await newFile('workspace');
    const page = (await alice.post('/api/files', { type: 'page', workspaceId: workspace.id })).data.file;
    const { data } = await alice.post(`/api/files/${workspace.id}/members`, { username: 'bob', role: 'editor' });
    const b = connect(server, bob, page.id);
    const bWorkspace = connect(server, bob, workspace.id);
    await Promise.all([b.synced, bWorkspace.synced]);
    assert.deepEqual(connections(page.id), { bob: 'write' });

    await alice.patch(`/api/files/${workspace.id}/members/${memberId(data.members, 'bob')}`, { role: 'viewer' });
    assert.deepEqual(connections(page.id), { bob: 'read' });
    await alice.post(`/api/files/${workspace.id}/trash`);
    assert.deepEqual(connections(page.id), {});
    assert.deepEqual(connections(workspace.id), {});

    b.destroy();
    bWorkspace.destroy();
  });
});
