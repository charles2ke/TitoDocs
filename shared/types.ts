// Types and constants shared by the server and the browser client.

export type FileType = 'doc' | 'code' | 'workspace' | 'page' | 'component';
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type MemberRole = Exclude<Role, 'owner'>;
export type LinkAccess = 'none' | 'view' | 'comment' | 'edit';
export type ComponentType = 'rich' | 'tasks' | 'voting' | 'progress' | 'qna';
export type FileView = 'recent' | 'mine' | 'shared' | 'starred' | 'trash';

export const FILE_TYPES: readonly FileType[] = ['doc', 'code', 'workspace', 'page', 'component'];
export const MEMBER_ROLES: readonly MemberRole[] = ['viewer', 'commenter', 'editor'];
export const LINK_ACCESS: readonly LinkAccess[] = ['none', 'view', 'comment', 'edit'];
export const COMPONENT_TYPES: readonly ComponentType[] = ['rich', 'tasks', 'voting', 'progress', 'qna'];

export const ROLE_RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const LINK_ROLE: Record<LinkAccess, MemberRole | null> = {
  none: null,
  view: 'viewer',
  comment: 'commenter',
  edit: 'editor',
};

export const canEdit = (role: Role | null | undefined): boolean => !!role && ROLE_RANK[role] >= ROLE_RANK.editor;
export const canComment = (role: Role | null | undefined): boolean =>
  !!role && ROLE_RANK[role] >= ROLE_RANK.commenter;

/** Yjs field holding rich-text content (TipTap's default fragment name). */
export const RICH_FIELD = 'default';
/** Yjs field holding the plain text of code files. */
export const CODE_FIELD = 'content';
/** Yjs map holding synced per-document settings (page setup, code EOL, ...). */
export const META_FIELD = 'meta';
/** Yjs array holding structured Loop component items. */
export const ITEMS_FIELD = 'items';
/** Yjs map holding comment threads (in the `<fileId>:comments` document). */
export const THREADS_FIELD = 'threads';

/** Collaboration document names: `<fileId>` for content, `<fileId>:comments` for comments. */
export const commentsDocName = (fileId: string): string => `${fileId}:comments`;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  color: string;
}

export interface FileMeta {
  id: string;
  type: FileType;
  title: string;
  icon: string | null;
  ownerId: string;
  ownerName: string;
  workspaceId: string | null;
  parentId: string | null;
  position: number;
  language: string | null;
  componentType: ComponentType | null;
  linkAccess: LinkAccess;
  createdAt: number;
  updatedAt: number;
  updatedByName: string | null;
  trashedAt: number | null;
  starred: boolean;
  role: Role;
}

export interface FileDetails {
  file: FileMeta;
  /** For pages: the containing workspace. */
  workspace: FileMeta | null;
}

export interface Member {
  user: PublicUser;
  role: MemberRole;
}

export interface SharingInfo {
  owner: PublicUser;
  linkAccess: LinkAccess;
  members: Member[];
  /** The file whose permissions apply (pages inherit from their workspace). */
  rootId: string;
}

export interface VersionMeta {
  id: string;
  name: string | null;
  auto: boolean;
  createdAt: number;
  createdByName: string | null;
}

export interface SearchResult extends FileMeta {
  snippet: string | null;
}

/** Stateless messages broadcast by the server over a collaboration document. */
export type StatelessMessage =
  | { type: 'meta'; file: Partial<FileMeta> & { id: string } }
  | { type: 'tree' }
  /** The file was trashed, restored or deleted, or its sharing changed: clients re-check it. */
  | { type: 'access' };
