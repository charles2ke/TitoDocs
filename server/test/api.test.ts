import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { RateLimiter } from '../http.ts';
import { Client, startTestServer, type TestServer } from './helpers.ts';

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

const createFile = async (client: Client, body: Record<string, unknown>) => {
  const { status, data } = await client.post('/api/files', body);
  assert.equal(status, 201, JSON.stringify(data));
  return data.file;
};

describe('auth', () => {
  it('signs in, out and rejects bad credentials', async () => {
    const carol = await Client.register(server.url, 'carol');
    assert.equal((await carol.get('/api/auth/me')).data.user.username, 'carol');
    await carol.post('/api/auth/logout');
    carol.cookie = '';
    assert.equal((await carol.get('/api/auth/me')).data.user, null);
    assert.equal((await carol.get('/api/files')).status, 401);

    const wrong = await carol.post('/api/auth/login', { username: 'carol', password: 'nope nope nope' });
    assert.equal(wrong.status, 401);
    const right = await carol.post('/api/auth/login', { username: 'CAROL', password: 'correct horse battery' });
    assert.equal(right.status, 200);
    assert.equal((await carol.get('/api/auth/me')).data.user.username, 'carol');
  });

  it('validates registrations', async () => {
    const client = new Client(server.url);
    assert.equal((await client.post('/api/auth/register', { username: 'Alice', password: 'long enough' })).status, 409);
    assert.equal((await client.post('/api/auth/register', { username: 'dave', password: 'short' })).status, 400);
    assert.equal((await client.post('/api/auth/register', { username: 'bad name', password: 'long enough' })).status, 400);
  });

  it('signs out other sessions when the password changes', async () => {
    const erin = await Client.register(server.url, 'erin');
    const otherDevice = new Client(server.url);
    await otherDevice.post('/api/auth/login', { username: 'erin', password: 'correct horse battery' });
    const changed = await erin.post('/api/auth/password', {
      currentPassword: 'correct horse battery',
      newPassword: 'even better horse',
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await otherDevice.get('/api/auth/me')).data.user, null);
    assert.equal((await erin.get('/api/auth/me')).data.user.username, 'erin');
    assert.equal(
      (await otherDevice.post('/api/auth/login', { username: 'erin', password: 'correct horse battery' })).status,
      401,
    );
    assert.equal(
      (await otherDevice.post('/api/auth/login', { username: 'erin', password: 'even better horse' })).status,
      200,
    );
  });

  it('blocks cross-origin writes', async () => {
    const response = await alice.request('POST', '/api/files', { type: 'doc' }, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
  });

  it('limits login attempts across usernames from one address', async () => {
    const client = new Client(server.url);
    let response: Awaited<ReturnType<Client['post']>> | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      response = await client.post('/api/auth/login', {
        username: `rotating-user-${attempt}`,
        password: 'wrong password',
      });
      if (response.status === 429) break;
      assert.equal(response.status, 401);
    }
    assert.equal(response?.status, 429);
  });
});

describe('rate limiter', () => {
  it('caps retained keys', () => {
    const limiter = new RateLimiter(1, 60_000, 2);
    assert.equal(limiter.take('first'), true);
    assert.equal(limiter.take('first'), false);
    assert.equal(limiter.take('second'), true);
    assert.equal(limiter.take('third'), true);
    assert.equal(limiter.take('first'), true);
  });
});

describe('files', () => {
  it('creates, renames, stars, trashes, restores and deletes', async () => {
    const doc = await createFile(alice, { type: 'doc', title: 'Plan' });
    assert.equal(doc.role, 'owner');

    const renamed = await alice.patch(`/api/files/${doc.id}`, { title: 'Roadmap' });
    assert.equal(renamed.data.file.title, 'Roadmap');

    await alice.post(`/api/files/${doc.id}/star`);
    const starred = await alice.get('/api/files?view=starred');
    assert.deepEqual(starred.data.files.map((file: { id: string }) => file.id), [doc.id]);

    await alice.post(`/api/files/${doc.id}/trash`);
    const recent = await alice.get('/api/files?view=recent');
    assert.ok(!recent.data.files.some((file: { id: string }) => file.id === doc.id));
    const trash = await alice.get('/api/files?view=trash');
    assert.ok(trash.data.files.some((file: { id: string }) => file.id === doc.id));
    assert.equal((await alice.patch(`/api/files/${doc.id}`, { title: 'x' })).status, 400);

    await alice.post(`/api/files/${doc.id}/restore`);
    assert.equal((await alice.get(`/api/files/${doc.id}`)).data.file.trashedAt, null);

    assert.equal((await alice.delete(`/api/files/${doc.id}`)).status, 200);
    assert.equal((await alice.get(`/api/files/${doc.id}`)).status, 404);
  });

  it('only lets code files have a language', async () => {
    const code = await createFile(alice, { type: 'code', title: 'main.py', language: 'Python' });
    assert.equal(code.language, 'Python');
    const doc = await createFile(alice, { type: 'doc' });
    assert.equal((await alice.patch(`/api/files/${doc.id}`, { language: 'Python' })).status, 400);
  });

  it('finds files by title for people with access only', async () => {
    await createFile(alice, { type: 'doc', title: 'Quarterly 100% report' });
    const mine = await alice.get('/api/files?q=quarterly');
    assert.equal(mine.data.files.length, 1);
    assert.equal((await alice.get('/api/files?q=' + encodeURIComponent('100%'))).data.files.length, 1);
    assert.equal((await alice.get('/api/files?q=' + encodeURIComponent('1_0'))).data.files.length, 0);
    assert.equal((await bob.get('/api/files?q=quarterly')).data.files.length, 0);
  });
});

describe('sharing and permissions', () => {
  it('enforces member roles', async () => {
    const doc = await createFile(alice, { type: 'doc', title: 'Secret' });
    assert.equal((await bob.get(`/api/files/${doc.id}`)).status, 404);

    await alice.post(`/api/files/${doc.id}/members`, { username: 'bob', role: 'viewer' });
    assert.equal((await bob.get(`/api/files/${doc.id}`)).data.file.role, 'viewer');
    assert.equal((await bob.patch(`/api/files/${doc.id}`, { title: 'Hacked' })).status, 403);
    assert.equal((await bob.get(`/api/files/${doc.id}/versions`)).status, 403);
    assert.equal((await bob.put(`/api/files/${doc.id}/sharing`, { linkAccess: 'edit' })).status, 403);
    const shared = await bob.get('/api/files?view=shared');
    assert.ok(shared.data.files.some((file: { id: string }) => file.id === doc.id));

    const sharing = await alice.get(`/api/files/${doc.id}/sharing`);
    const bobId = sharing.data.members[0].user.id;
    await alice.patch(`/api/files/${doc.id}/members/${bobId}`, { role: 'editor' });
    assert.equal((await bob.patch(`/api/files/${doc.id}`, { title: 'Edited by Bob' })).status, 200);
    assert.equal((await bob.post(`/api/files/${doc.id}/trash`)).status, 403);
    assert.equal((await bob.delete(`/api/files/${doc.id}`)).status, 403);

    await alice.delete(`/api/files/${doc.id}/members/${bobId}`);
    assert.equal((await bob.get(`/api/files/${doc.id}`)).status, 404);
  });

  it('grants link access to anyone signed in, and lists the file once visited', async () => {
    const doc = await createFile(alice, { type: 'doc', title: 'Public notes' });
    await alice.put(`/api/files/${doc.id}/sharing`, { linkAccess: 'comment' });
    const before = await bob.get('/api/files?view=recent');
    assert.ok(!before.data.files.some((file: { id: string }) => file.id === doc.id));

    assert.equal((await bob.get(`/api/files/${doc.id}`)).data.file.role, 'commenter');
    const afterVisit = await bob.get('/api/files?view=recent');
    assert.ok(afterVisit.data.files.some((file: { id: string }) => file.id === doc.id));

    await alice.post(`/api/files/${doc.id}/trash`);
    assert.equal((await bob.get(`/api/files/${doc.id}`)).status, 404);
  });

  it('lets people leave a file they were added to', async () => {
    const doc = await createFile(alice, { type: 'doc' });
    await alice.post(`/api/files/${doc.id}/members`, { username: 'bob', role: 'editor' });
    const me = (await bob.get('/api/auth/me')).data.user;
    assert.equal((await bob.delete(`/api/files/${doc.id}/members/${me.id}`)).status, 200);
    assert.equal((await bob.get(`/api/files/${doc.id}`)).status, 404);
  });
});

describe('workspaces and pages', () => {
  it('builds a page tree that inherits workspace permissions', async () => {
    const workspace = await createFile(alice, { type: 'workspace', title: 'Team' });
    const parent = await createFile(alice, { type: 'page', workspaceId: workspace.id, title: 'Parent' });
    const child = await createFile(alice, { type: 'page', workspaceId: workspace.id, parentId: parent.id, title: 'Child' });

    const pages = (await alice.get(`/api/files/${workspace.id}/pages`)).data.pages;
    assert.deepEqual(pages.map((page: { title: string }) => page.title).sort(), ['Child', 'Parent']);
    assert.equal((await alice.patch(`/api/files/${parent.id}`, { parentId: child.id })).status, 400);

    assert.equal((await bob.get(`/api/files/${child.id}`)).status, 404);
    await alice.post(`/api/files/${workspace.id}/members`, { username: 'bob', role: 'viewer' });
    const viaWorkspace = await bob.get(`/api/files/${child.id}`);
    assert.equal(viaWorkspace.data.file.role, 'viewer');
    assert.equal(viaWorkspace.data.workspace.id, workspace.id);
    assert.equal((await bob.post('/api/files', { type: 'page', workspaceId: workspace.id })).status, 403);
    assert.equal((await bob.get(`/api/files/${child.id}/sharing`)).data.rootId, workspace.id);
  });

  it('trashes and restores a page together with its sub-pages', async () => {
    const workspace = await createFile(alice, { type: 'workspace' });
    const parent = await createFile(alice, { type: 'page', workspaceId: workspace.id, title: 'Parent' });
    await createFile(alice, { type: 'page', workspaceId: workspace.id, parentId: parent.id, title: 'Child' });

    await alice.post(`/api/files/${parent.id}/trash`);
    assert.equal((await alice.get(`/api/files/${workspace.id}/pages`)).data.pages.length, 0);
    const trash = (await alice.get('/api/files?view=trash')).data.files;
    assert.deepEqual(
      trash.filter((file: { workspaceId: string }) => file.workspaceId === workspace.id).map((file: { title: string }) => file.title),
      ['Parent'],
    );

    await alice.post(`/api/files/${parent.id}/restore`);
    assert.equal((await alice.get(`/api/files/${workspace.id}/pages`)).data.pages.length, 2);
  });

  it('deleting a workspace deletes its pages', async () => {
    const workspace = await createFile(alice, { type: 'workspace' });
    const page = await createFile(alice, { type: 'page', workspaceId: workspace.id });
    await alice.delete(`/api/files/${workspace.id}`);
    assert.equal((await alice.get(`/api/files/${page.id}`)).status, 404);
  });
});

describe('components', () => {
  it('are editable by anyone with the link by default', async () => {
    const component = await createFile(alice, { type: 'component', componentType: 'tasks' });
    assert.equal(component.componentType, 'tasks');
    assert.equal((await bob.get(`/api/files/${component.id}`)).data.file.role, 'editor');
    const recent = (await alice.get('/api/files?view=recent')).data.files;
    assert.ok(!recent.some((file: { id: string }) => file.id === component.id));
  });
});

describe('versions', () => {
  it('saves and downloads named versions', async () => {
    const doc = await createFile(alice, { type: 'doc' });
    const created = await alice.post(`/api/files/${doc.id}/versions`, { name: 'First draft' });
    assert.equal(created.status, 201);
    assert.equal(created.data.version.name, 'First draft');
    const download = await alice.get(`/api/files/${doc.id}/versions/${created.data.version.id}`);
    assert.equal(download.status, 200);
    assert.ok(download.data instanceof ArrayBuffer);
    const renamed = await alice.patch(`/api/files/${doc.id}/versions/${created.data.version.id}`, { name: 'Final' });
    assert.equal(renamed.data.versions[0].name, 'Final');
  });
});

describe('uploads', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  it('stores images and serves them to signed-in users only', async () => {
    const response = await alice.request('POST', '/api/uploads', new Uint8Array(png), { 'content-type': 'image/png' });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.match(response.data.url, /^\/uploads\/[\w-]+\.png$/);

    const image = await fetch(server.url + response.data.url, { headers: { cookie: bob.cookie } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(server.url + response.data.url)).status, 401);
  });

  it('rejects anything that is not an image, whatever its declared type', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const response = await alice.request('POST', '/api/uploads', html, { 'content-type': 'image/png' });
    assert.equal(response.status, 415);
    const traversal = await fetch(server.url + '/uploads/..%2Ftitodocs.db', { headers: { cookie: alice.cookie } });
    assert.equal(traversal.status, 404);
  });
});
