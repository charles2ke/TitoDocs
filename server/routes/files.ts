import { Router, type Request } from 'express';
import * as Y from 'yjs';
import type { Collab } from '../collab.ts';
import { transaction, type DB } from '../db.ts';
import {
  badRequest,
  currentUser,
  forbidden,
  notFound,
  optionalString,
  requireAuth,
  requireOneOf,
  requireString,
} from '../http.ts';
import {
  createFile,
  createVersion,
  escapeLike,
  getAclRoot,
  getFile,
  getRole,
  getUserById,
  getUserByUsername,
  listMembers,
  listPages,
  listVersions,
  pageSubtree,
  recordVisit,
  storeState,
  toFileMeta,
  toPublicUser,
  upsertMember,
  type FileRow,
  type UserRow,
} from '../models.ts';
import { snippet } from '../text.ts';
import {
  COMPONENT_TYPES,
  LINK_ACCESS,
  MEMBER_ROLES,
  ROLE_RANK,
  type ComponentType,
  type FileMeta,
  type FileType,
  type FileView,
  type LinkAccess,
  type Role,
  type SearchResult,
  type SharingInfo,
} from '../../shared/types.ts';

const CREATABLE: readonly FileType[] = ['doc', 'code', 'workspace', 'page', 'component'];
const LISTED_TYPES: readonly FileType[] = ['doc', 'code', 'workspace'];
const VIEWS: readonly FileView[] = ['recent', 'mine', 'shared', 'starred', 'trash'];
const DEFAULT_TITLES: Record<FileType, string> = {
  doc: 'Untitled document',
  code: 'untitled.txt',
  workspace: 'Untitled workspace',
  page: 'Untitled page',
  component: 'Loop component',
};

interface Loaded {
  file: FileRow;
  role: Role;
  user: UserRow;
}

const atLeast = (role: Role, minimum: Role): boolean => ROLE_RANK[role] >= ROLE_RANK[minimum];

function requireAtLeast(role: Role, minimum: Role, message?: string): void {
  if (!atLeast(role, minimum)) throw forbidden(message);
}

/** Who may trash, restore or delete a file: owners, or workspace editors for pages. */
function requireManage(loaded: Loaded): void {
  const { file, role, user } = loaded;
  if (file.type === 'page') return requireAtLeast(role, 'editor');
  if (file.owner_id !== user.id) throw forbidden('Only the owner can do that.');
}

export function fileRoutes(db: DB, collab: Collab): Router {
  const router = Router();
  router.use(requireAuth);

  const load = (req: Request): Loaded => {
    const user = currentUser(req);
    const file = getFile(db, String(req.params.id));
    const role = file ? getRole(db, user.id, file) : null;
    if (!file || !role) throw notFound('This file does not exist or you do not have access to it.');
    return { file, role, user };
  };

  const meta = (file: FileRow, user: UserRow): FileMeta | null => {
    const role = getRole(db, user.id, file);
    return role ? toFileMeta(db, file, user.id, role) : null;
  };

  const notifyChanged = (file: FileRow, user: UserRow): void => {
    const updated = getFile(db, file.id);
    const fileMeta = updated && meta(updated, user);
    if (fileMeta) {
      const { role: _role, starred: _starred, ...shared } = fileMeta;
      collab.broadcast(file.id, { type: 'meta', file: shared });
    }
    if (file.workspace_id) collab.broadcast(file.workspace_id, { type: 'tree' });
  };

  // ------------------------------------------------------------ listing & search

  router.get('/', (req, res) => {
    const user = currentUser(req);
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    const typeFilter = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;

    if (query) {
      const like = `%${escapeLike(query)}%`;
      const rows = db
        .prepare(
          `SELECT f.* FROM files f
           WHERE f.trashed_at IS NULL AND f.type IN ('doc', 'code', 'workspace', 'page')
             AND (f.title LIKE :like ESCAPE '\\' OR f.text_content LIKE :like ESCAPE '\\')
             AND EXISTS (
               SELECT 1 FROM files r
               LEFT JOIN file_members m ON m.file_id = r.id AND m.user_id = :uid
               LEFT JOIN file_visits v ON v.file_id = r.id AND v.user_id = :uid
               WHERE r.id = COALESCE(f.workspace_id, f.id) AND r.trashed_at IS NULL
                 AND (r.owner_id = :uid OR m.role IS NOT NULL OR (r.link_access != 'none' AND v.visited_at IS NOT NULL)))
           ORDER BY f.updated_at DESC LIMIT 100`,
        )
        .all({ like, uid: user.id }) as unknown as FileRow[];
      const results: SearchResult[] = [];
      for (const row of rows) {
        if (typeFilter && row.type !== typeFilter) continue;
        const fileMeta = meta(row, user);
        if (fileMeta) results.push({ ...fileMeta, snippet: snippet(row.text_content, query) });
      }
      res.json({ files: results });
      return;
    }

    const view = req.query.view === undefined ? 'recent' : requireOneOf(req.query.view, VIEWS, 'view');
    let rows: FileRow[];
    if (view === 'starred') {
      rows = db
        .prepare(
          `SELECT f.* FROM stars s JOIN files f ON f.id = s.file_id
           WHERE s.user_id = ? AND f.trashed_at IS NULL AND f.type != 'component' ORDER BY s.created_at DESC`,
        )
        .all(user.id) as unknown as FileRow[];
    } else if (view === 'trash') {
      // Sub-pages trashed together with their parent are restored with it, so only list the parent.
      rows = db
        .prepare(
          `SELECT f.* FROM files f WHERE f.owner_id = ? AND f.trashed_at IS NOT NULL AND f.type != 'component'
           AND NOT EXISTS (SELECT 1 FROM files p WHERE p.id = f.parent_id AND p.trashed_at = f.trashed_at)
           ORDER BY f.trashed_at DESC`,
        )
        .all(user.id) as unknown as FileRow[];
    } else {
      const conditions: Record<string, string> = {
        recent: 'f.trashed_at IS NULL',
        mine: 'f.trashed_at IS NULL AND f.owner_id = :uid',
        shared: 'f.trashed_at IS NULL AND f.owner_id != :uid',
      };
      const order: Record<string, string> = {
        recent: `MAX(COALESCE(v.visited_at, 0), CASE WHEN f.owner_id = :uid THEN f.updated_at ELSE 0 END) DESC`,
        mine: 'f.updated_at DESC',
        shared: 'COALESCE(v.visited_at, m.created_at) DESC',
      };
      rows = db
        .prepare(
          `SELECT f.* FROM files f
           LEFT JOIN file_members m ON m.file_id = f.id AND m.user_id = :uid
           LEFT JOIN file_visits v ON v.file_id = f.id AND v.user_id = :uid
           WHERE f.type IN ('doc', 'code', 'workspace') AND ${conditions[view]}
             AND (f.owner_id = :uid OR m.role IS NOT NULL OR (f.link_access != 'none' AND v.visited_at IS NOT NULL))
           ORDER BY ${order[view]} LIMIT 500`,
        )
        .all({ uid: user.id }) as unknown as FileRow[];
    }
    const files: FileMeta[] = [];
    for (const row of rows) {
      if (typeFilter && row.type !== typeFilter) continue;
      if (view !== 'starred' && view !== 'trash' && !LISTED_TYPES.includes(row.type)) continue;
      const fileMeta = meta(row, user);
      if (fileMeta) files.push(fileMeta);
    }
    res.json({ files });
  });

  // ------------------------------------------------------------ create

  router.post('/', (req, res) => {
    const user = currentUser(req);
    const type = requireOneOf(req.body?.type, CREATABLE, 'type');
    const title = optionalString(req.body?.title, 'Title', 200) ?? DEFAULT_TITLES[type];
    const icon = optionalString(req.body?.icon, 'Icon', 16) ?? null;
    let workspaceId: string | null = null;
    let parentId: string | null = null;
    let language: string | null = null;
    let componentType: ComponentType | null = null;
    let linkAccess: LinkAccess = 'none';

    if (type === 'page') {
      workspaceId = requireString(req.body?.workspaceId, 'workspaceId');
      const workspace = getFile(db, workspaceId);
      const role = workspace ? getRole(db, user.id, workspace) : null;
      if (!workspace || workspace.type !== 'workspace' || workspace.trashed_at || !role) {
        throw notFound('Workspace not found.');
      }
      requireAtLeast(role, 'editor', 'You need edit access to add pages to this workspace.');
      if (req.body?.parentId) {
        parentId = requireString(req.body.parentId, 'parentId');
        const parent = getFile(db, parentId);
        if (!parent || parent.type !== 'page' || parent.workspace_id !== workspaceId || parent.trashed_at) {
          throw badRequest('Invalid parent page.');
        }
      }
    } else if (type === 'code') {
      language = optionalString(req.body?.language, 'language', 40) ?? null;
    } else if (type === 'component') {
      componentType = requireOneOf(req.body?.componentType ?? 'rich', COMPONENT_TYPES, 'componentType');
      // Like Loop, components are editable by anyone signed in who has the link.
      linkAccess = 'edit';
    }

    const file = createFile(db, { type, title, icon, ownerId: user.id, workspaceId, parentId, language, componentType, linkAccess });
    recordVisit(db, user.id, file.id);
    if (workspaceId) collab.broadcast(workspaceId, { type: 'tree' });
    res.status(201).json({ file: meta(file, user) });
  });

  // ------------------------------------------------------------ read & update

  router.get('/:id', (req, res) => {
    const { file, role, user } = load(req);
    recordVisit(db, user.id, file.id);
    let workspace: FileMeta | null = null;
    if (file.workspace_id) {
      const row = getFile(db, file.workspace_id);
      if (row) {
        recordVisit(db, user.id, row.id);
        workspace = meta(row, user);
      }
    }
    res.json({ file: toFileMeta(db, file, user.id, role), workspace });
  });

  router.patch('/:id', (req, res) => {
    const loaded = load(req);
    const { file, role, user } = loaded;
    requireAtLeast(role, 'editor', 'You need edit access to change this file.');
    if (file.trashed_at) throw badRequest('Restore this file from the trash first.');
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    const title = optionalString(req.body?.title, 'Title', 200);
    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title ?? DEFAULT_TITLES[file.type]);
    }
    const icon = optionalString(req.body?.icon, 'Icon', 16);
    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }
    if (req.body?.language !== undefined) {
      if (file.type !== 'code') throw badRequest('Only code files have a language.');
      updates.push('language = ?');
      values.push(optionalString(req.body.language, 'language', 40) ?? null);
    }
    if (req.body?.parentId !== undefined || req.body?.position !== undefined) {
      if (file.type !== 'page') throw badRequest('Only pages can be moved.');
      if (req.body.parentId !== undefined) {
        const parentId = req.body.parentId === null ? null : requireString(req.body.parentId, 'parentId');
        if (parentId) {
          const parent = getFile(db, parentId);
          if (!parent || parent.workspace_id !== file.workspace_id || parent.trashed_at) throw badRequest('Invalid parent page.');
          if (pageSubtree(db, file.id).includes(parentId)) throw badRequest('A page cannot be moved inside itself.');
        }
        updates.push('parent_id = ?');
        values.push(parentId);
      }
      if (req.body.position !== undefined) {
        const position = Number(req.body.position);
        if (!Number.isFinite(position)) throw badRequest('position must be a number.');
        updates.push('position = ?');
        values.push(position);
      }
    }
    if (updates.length) {
      updates.push('updated_at = ?', 'updated_by = ?');
      values.push(Date.now(), user.id);
      db.prepare(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`).run(...values, file.id);
      notifyChanged(file, user);
    }
    res.json({ file: meta(getFile(db, file.id)!, user) });
  });

  // ------------------------------------------------------------ trash, restore, delete, duplicate

  router.post('/:id/trash', (req, res) => {
    const loaded = load(req);
    requireManage(loaded);
    const { file, user } = loaded;
    const now = Date.now();
    const ids = file.type === 'page' ? pageSubtree(db, file.id) : [file.id];
    transaction(db, () => {
      for (const id of ids) db.prepare('UPDATE files SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL').run(now, id);
    });
    ids.forEach((id) => collab.closeFile(id));
    if (file.workspace_id) collab.broadcast(file.workspace_id, { type: 'tree' });
    res.json({ file: meta(getFile(db, file.id)!, user) });
  });

  router.post('/:id/restore', (req, res) => {
    const loaded = load(req);
    requireManage(loaded);
    const { file, user } = loaded;
    if (!file.trashed_at) throw badRequest('This file is not in the trash.');
    transaction(db, () => {
      if (file.type === 'page') {
        for (const id of pageSubtree(db, file.id)) {
          db.prepare('UPDATE files SET trashed_at = NULL WHERE id = ? AND trashed_at = ?').run(id, file.trashed_at);
        }
        const parent = file.parent_id ? getFile(db, file.parent_id) : null;
        if (file.parent_id && (!parent || parent.trashed_at)) {
          db.prepare('UPDATE files SET parent_id = NULL WHERE id = ?').run(file.id);
        }
      } else {
        db.prepare('UPDATE files SET trashed_at = NULL WHERE id = ?').run(file.id);
      }
    });
    if (file.workspace_id) collab.broadcast(file.workspace_id, { type: 'tree' });
    res.json({ file: meta(getFile(db, file.id)!, user) });
  });

  router.delete('/:id', (req, res) => {
    const loaded = load(req);
    requireManage(loaded);
    const { file } = loaded;
    const ids =
      file.type === 'workspace'
        ? [file.id, ...listPagesIncludingTrashed(db, file.id)]
        : file.type === 'page'
          ? pageSubtree(db, file.id)
          : [file.id];
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    ids.forEach((id) => collab.closeFile(id));
    if (file.workspace_id) collab.broadcast(file.workspace_id, { type: 'tree' });
    res.json({ ok: true });
  });

  router.post('/:id/duplicate', (req, res) => {
    const { file, user } = load(req);
    if (file.type !== 'doc' && file.type !== 'code') throw badRequest('Only documents and code files can be copied.');
    const title = optionalString(req.body?.title, 'Title', 200) ?? `Copy of ${file.title}`;
    const copy = transaction(db, () => {
      const created = createFile(db, { type: file.type, title, ownerId: user.id, language: file.language, icon: file.icon });
      const state = collab.getState(file.id);
      if (state) {
        storeState(db, created.id, created.id, state);
        db.prepare('UPDATE files SET text_content = ? WHERE id = ?').run(file.text_content, created.id);
      }
      return created;
    });
    recordVisit(db, user.id, copy.id);
    res.status(201).json({ file: meta(copy, user) });
  });

  // ------------------------------------------------------------ stars

  router.post('/:id/star', (req, res) => {
    const { file, user } = load(req);
    db.prepare('INSERT OR IGNORE INTO stars (user_id, file_id, created_at) VALUES (?, ?, ?)').run(user.id, file.id, Date.now());
    res.json({ starred: true });
  });

  router.delete('/:id/star', (req, res) => {
    const { file, user } = load(req);
    db.prepare('DELETE FROM stars WHERE user_id = ? AND file_id = ?').run(user.id, file.id);
    res.json({ starred: false });
  });

  // ------------------------------------------------------------ sharing (applies to the ACL root)

  const sharingInfo = (root: FileRow): SharingInfo => ({
    owner: toPublicUser(getUserById(db, root.owner_id)!),
    linkAccess: root.link_access,
    members: listMembers(db, root.id),
    rootId: root.id,
  });

  const loadRoot = (req: Request, manage: boolean): { root: FileRow; user: UserRow } => {
    const { file, role, user } = load(req);
    const root = getAclRoot(db, file);
    if (!root) throw notFound();
    if (manage) requireAtLeast(role, 'editor', 'Only editors can change sharing settings.');
    return { root, user };
  };

  router.get('/:id/sharing', (req, res) => {
    res.json(sharingInfo(loadRoot(req, false).root));
  });

  router.put('/:id/sharing', (req, res) => {
    const { root } = loadRoot(req, true);
    const linkAccess = requireOneOf(req.body?.linkAccess, LINK_ACCESS, 'linkAccess');
    db.prepare('UPDATE files SET link_access = ? WHERE id = ?').run(linkAccess, root.id);
    res.json(sharingInfo(getFile(db, root.id)!));
  });

  router.post('/:id/members', (req, res) => {
    const { root } = loadRoot(req, true);
    const username = requireString(req.body?.username, 'Username', { max: 64 });
    const role = requireOneOf(req.body?.role ?? 'editor', MEMBER_ROLES, 'role');
    const target = getUserByUsername(db, username);
    if (!target) throw notFound(`No user named "${username}".`);
    if (target.id === root.owner_id) throw badRequest('The owner already has full access.');
    upsertMember(db, root.id, target.id, role);
    res.json(sharingInfo(root));
  });

  router.patch('/:id/members/:userId', (req, res) => {
    const { root } = loadRoot(req, true);
    const role = requireOneOf(req.body?.role, MEMBER_ROLES, 'role');
    const result = db
      .prepare('UPDATE file_members SET role = ? WHERE file_id = ? AND user_id = ?')
      .run(role, root.id, String(req.params.userId));
    if (!result.changes) throw notFound('That person is not a member.');
    res.json(sharingInfo(root));
  });

  router.delete('/:id/members/:userId', (req, res) => {
    const targetId = String(req.params.userId);
    const self = currentUser(req).id === targetId;
    const { root } = loadRoot(req, !self);
    db.prepare('DELETE FROM file_members WHERE file_id = ? AND user_id = ?').run(root.id, targetId);
    collab.closeFile(root.id);
    res.json(sharingInfo(root));
  });

  // ------------------------------------------------------------ version history (editors only, like Google Docs)

  router.get('/:id/versions', (req, res) => {
    const { file, role } = load(req);
    requireAtLeast(role, 'editor', 'You need edit access to see version history.');
    res.json({ versions: listVersions(db, file.id) });
  });

  router.post('/:id/versions', (req, res) => {
    const { file, role, user } = load(req);
    requireAtLeast(role, 'editor', 'You need edit access to save versions.');
    const name = optionalString(req.body?.name, 'Name', 120) ?? null;
    const state = collab.getState(file.id) ?? Y.encodeStateAsUpdate(new Y.Doc());
    const id = createVersion(db, file.id, state, { name, userId: user.id });
    res.status(201).json({ version: listVersions(db, file.id).find((version) => version.id === id) });
  });

  router.get('/:id/versions/:versionId', (req, res) => {
    const { file, role } = load(req);
    requireAtLeast(role, 'editor', 'You need edit access to see version history.');
    const row = db
      .prepare('SELECT state FROM versions WHERE id = ? AND file_id = ?')
      .get(String(req.params.versionId), file.id) as { state: Uint8Array } | undefined;
    if (!row) throw notFound('Version not found.');
    res.type('application/octet-stream').send(Buffer.from(row.state));
  });

  router.patch('/:id/versions/:versionId', (req, res) => {
    const { file, role } = load(req);
    requireAtLeast(role, 'editor');
    const name = optionalString(req.body?.name, 'Name', 120) ?? null;
    const result = db
      .prepare('UPDATE versions SET name = ? WHERE id = ? AND file_id = ?')
      .run(name, String(req.params.versionId), file.id);
    if (!result.changes) throw notFound('Version not found.');
    res.json({ versions: listVersions(db, file.id) });
  });

  // ------------------------------------------------------------ workspace pages

  router.get('/:id/pages', (req, res) => {
    const { file, user } = load(req);
    if (file.type !== 'workspace') throw badRequest('Only workspaces have pages.');
    const pages = listPages(db, file.id)
      .map((page) => meta(page, user))
      .filter((page): page is FileMeta => !!page);
    res.json({ pages });
  });

  router.get('/:id/trashed-pages', (req, res) => {
    const { file, role, user } = load(req);
    if (file.type !== 'workspace') throw badRequest('Only workspaces have pages.');
    requireAtLeast(role, 'editor');
    const rows = db
      .prepare('SELECT * FROM files WHERE workspace_id = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC')
      .all(file.id) as unknown as FileRow[];
    res.json({ pages: rows.map((page) => meta(page, user)).filter(Boolean) });
  });

  return router;
}

const listPagesIncludingTrashed = (db: DB, workspaceId: string): string[] =>
  (db.prepare('SELECT id FROM files WHERE workspace_id = ?').all(workspaceId) as { id: string }[]).map((row) => row.id);
