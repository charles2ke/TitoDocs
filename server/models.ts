import type { DB } from './db.ts';
import { newId } from './security.ts';
import {
  LINK_ROLE,
  ROLE_RANK,
  type ComponentType,
  type FileMeta,
  type FileType,
  type LinkAccess,
  type Member,
  type MemberRole,
  type PublicUser,
  type Role,
  type VersionMeta,
} from '../shared/types.ts';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  color: string;
  created_at: number;
}

export interface FileRow {
  id: string;
  type: FileType;
  title: string;
  icon: string | null;
  owner_id: string;
  workspace_id: string | null;
  parent_id: string | null;
  position: number;
  language: string | null;
  component_type: ComponentType | null;
  link_access: LinkAccess;
  text_content: string;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  trashed_at: number | null;
}

export const toPublicUser = (user: UserRow): PublicUser => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
  color: user.color,
});

// ---------------------------------------------------------------- users

export const getUserById = (db: DB, id: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export const getUserByUsername = (db: DB, username: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

export function createUser(
  db: DB,
  input: { username: string; displayName: string; passwordHash: string; color: string },
): UserRow {
  const id = newId();
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.username, input.displayName, input.passwordHash, input.color, Date.now());
  return getUserById(db, id)!;
}

export function searchUsers(db: DB, query: string, limit = 10): PublicUser[] {
  const like = `%${escapeLike(query)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
       ORDER BY display_name COLLATE NOCASE LIMIT ?`,
    )
    .all(like, like, limit) as unknown as UserRow[];
  return rows.map(toPublicUser);
}

export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------------------------------------------------------------- files

export const getFile = (db: DB, id: string): FileRow | undefined =>
  db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;

/** The file whose sharing settings govern access (pages inherit from their workspace). */
export const getAclRoot = (db: DB, file: FileRow): FileRow | undefined =>
  file.workspace_id ? getFile(db, file.workspace_id) : file;

const maxRole = (a: Role | null, b: Role | null): Role | null => {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
};

export function getRole(db: DB, userId: string, file: FileRow): Role | null {
  const root = getAclRoot(db, file);
  if (!root) return null;
  let role: Role | null;
  if (root.owner_id === userId) {
    role = 'owner';
  } else if (root.trashed_at) {
    return null;
  } else {
    const member = db
      .prepare('SELECT role FROM file_members WHERE file_id = ? AND user_id = ?')
      .get(root.id, userId) as { role: MemberRole } | undefined;
    role = maxRole(member?.role ?? null, LINK_ROLE[root.link_access]);
  }
  // A trashed page stays reachable for workspace editors so they can restore it.
  if (role && file !== root && file.trashed_at && ROLE_RANK[role] < ROLE_RANK.editor) return null;
  return role;
}

export function toFileMeta(db: DB, file: FileRow, userId: string, role: Role): FileMeta {
  const owner = getUserById(db, file.owner_id);
  const updatedBy = file.updated_by ? getUserById(db, file.updated_by) : undefined;
  const starred = !!db.prepare('SELECT 1 FROM stars WHERE user_id = ? AND file_id = ?').get(userId, file.id);
  return {
    id: file.id,
    type: file.type,
    title: file.title,
    icon: file.icon,
    ownerId: file.owner_id,
    ownerName: owner?.display_name ?? 'Unknown',
    workspaceId: file.workspace_id,
    parentId: file.parent_id,
    position: file.position,
    language: file.language,
    componentType: file.component_type,
    linkAccess: file.link_access,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    updatedByName: updatedBy?.display_name ?? null,
    trashedAt: file.trashed_at,
    starred,
    role,
  };
}

export interface NewFile {
  type: FileType;
  title: string;
  ownerId: string;
  icon?: string | null;
  workspaceId?: string | null;
  parentId?: string | null;
  language?: string | null;
  componentType?: ComponentType | null;
  linkAccess?: LinkAccess;
}

export function createFile(db: DB, input: NewFile): FileRow {
  const id = newId();
  const now = Date.now();
  let position = 0;
  if (input.workspaceId) {
    const row = db
      .prepare('SELECT MAX(position) AS max FROM files WHERE workspace_id = ? AND parent_id IS ?')
      .get(input.workspaceId, input.parentId ?? null) as { max: number | null };
    position = (row.max ?? 0) + 1;
  }
  db.prepare(
    `INSERT INTO files (id, type, title, icon, owner_id, workspace_id, parent_id, position, language,
       component_type, link_access, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.title,
    input.icon ?? null,
    input.ownerId,
    input.workspaceId ?? null,
    input.parentId ?? null,
    position,
    input.language ?? null,
    input.componentType ?? null,
    input.linkAccess ?? 'none',
    now,
    now,
    input.ownerId,
  );
  return getFile(db, id)!;
}

export function recordVisit(db: DB, userId: string, fileId: string): void {
  db.prepare(
    `INSERT INTO file_visits (file_id, user_id, visited_at) VALUES (?, ?, ?)
     ON CONFLICT (file_id, user_id) DO UPDATE SET visited_at = excluded.visited_at`,
  ).run(fileId, userId, Date.now());
}

/** All pages of a workspace that are not in the trash. */
export const listPages = (db: DB, workspaceId: string): FileRow[] =>
  db
    .prepare('SELECT * FROM files WHERE workspace_id = ? AND trashed_at IS NULL ORDER BY position, created_at')
    .all(workspaceId) as unknown as FileRow[];

/** Ids of `pageId` and all of its descendants. */
export function pageSubtree(db: DB, pageId: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM files WHERE id = ?
         UNION ALL SELECT f.id FROM files f JOIN tree t ON f.parent_id = t.id
       ) SELECT id FROM tree`,
    )
    .all(pageId) as { id: string }[];
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------- sharing

export function listMembers(db: DB, fileId: string): Member[] {
  const rows = db
    .prepare(
      `SELECT u.*, m.role AS member_role FROM file_members m JOIN users u ON u.id = m.user_id
       WHERE m.file_id = ? ORDER BY m.created_at`,
    )
    .all(fileId) as unknown as (UserRow & { member_role: MemberRole })[];
  return rows.map((row) => ({ user: toPublicUser(row), role: row.member_role }));
}

export function upsertMember(db: DB, fileId: string, userId: string, role: MemberRole): void {
  db.prepare(
    `INSERT INTO file_members (file_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (file_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(fileId, userId, role, Date.now());
}

// ---------------------------------------------------------------- yjs state & versions

export const getStoredState = (db: DB, name: string): Uint8Array | undefined =>
  (db.prepare('SELECT state FROM ydocs WHERE name = ?').get(name) as { state: Uint8Array } | undefined)?.state;

export function storeState(db: DB, name: string, fileId: string, state: Uint8Array): void {
  db.prepare(
    `INSERT INTO ydocs (name, file_id, state, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(name, fileId, state, Date.now());
}

export function createVersion(
  db: DB,
  fileId: string,
  state: Uint8Array,
  options: { name?: string | null; auto?: boolean; userId?: string | null },
): string {
  const id = newId();
  db.prepare(
    'INSERT INTO versions (id, file_id, name, auto, created_at, created_by, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, fileId, options.name ?? null, options.auto ? 1 : 0, Date.now(), options.userId ?? null, state);
  return id;
}

export function listVersions(db: DB, fileId: string): VersionMeta[] {
  const rows = db
    .prepare(
      `SELECT v.id, v.name, v.auto, v.created_at, u.display_name FROM versions v
       LEFT JOIN users u ON u.id = v.created_by WHERE v.file_id = ? ORDER BY v.created_at DESC, v.rowid DESC`,
    )
    .all(fileId) as { id: string; name: string | null; auto: number; created_at: number; display_name: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    auto: row.auto === 1,
    createdAt: row.created_at,
    createdByName: row.display_name,
  }));
}

/** Keeps only the newest `keep` automatic versions of a file. */
export function pruneAutoVersions(db: DB, fileId: string, keep = 50): void {
  db.prepare(
    `DELETE FROM versions WHERE file_id = ? AND auto = 1 AND id NOT IN (
       SELECT id FROM versions WHERE file_id = ? AND auto = 1 ORDER BY created_at DESC LIMIT ?)`,
  ).run(fileId, fileId, keep);
}
