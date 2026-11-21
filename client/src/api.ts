import type {
  ComponentType,
  FileDetails,
  FileMeta,
  FileType,
  FileView,
  LinkAccess,
  MemberRole,
  PublicUser,
  SearchResult,
  SharingInfo,
  VersionMeta,
} from '@shared/types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = response.statusText || 'Request failed';
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // Not JSON (e.g. a proxy error page).
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export interface NewFileInput {
  type: FileType;
  title?: string;
  icon?: string | null;
  workspaceId?: string;
  parentId?: string | null;
  language?: string | null;
  componentType?: ComponentType;
}

export interface FilePatch {
  title?: string;
  icon?: string | null;
  language?: string | null;
  parentId?: string | null;
  position?: number;
}

const query = (params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  config: () => request<{ allowRegistration: boolean }>('GET', '/auth/config'),
  me: () => request<{ user: PublicUser | null }>('GET', '/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: PublicUser }>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string, displayName: string) =>
    request<{ user: PublicUser }>('POST', '/auth/register', { username, password, displayName }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  updateProfile: (patch: { displayName?: string; color?: string }) =>
    request<{ user: PublicUser }>('PATCH', '/auth/me', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('POST', '/auth/password', { currentPassword, newPassword }),

  listFiles: (view: FileView, type?: FileType) => request<{ files: FileMeta[] }>('GET', `/files${query({ view, type })}`),
  search: (q: string, type?: FileType) => request<{ files: SearchResult[] }>('GET', `/files${query({ q, type })}`),
  createFile: (input: NewFileInput) => request<{ file: FileMeta }>('POST', '/files', input),
  getFile: (id: string) => request<FileDetails>('GET', `/files/${id}`),
  updateFile: (id: string, patch: FilePatch) => request<{ file: FileMeta }>('PATCH', `/files/${id}`, patch),
  trash: (id: string) => request<{ file: FileMeta }>('POST', `/files/${id}/trash`),
  restore: (id: string) => request<{ file: FileMeta }>('POST', `/files/${id}/restore`),
  deleteForever: (id: string) => request<{ ok: true }>('DELETE', `/files/${id}`),
  duplicate: (id: string, title?: string) => request<{ file: FileMeta }>('POST', `/files/${id}/duplicate`, { title }),
  star: (id: string, starred: boolean) =>
    request<{ starred: boolean }>(starred ? 'POST' : 'DELETE', `/files/${id}/star`),

  sharing: (id: string) => request<SharingInfo>('GET', `/files/${id}/sharing`),
  setLinkAccess: (id: string, linkAccess: LinkAccess) =>
    request<SharingInfo>('PUT', `/files/${id}/sharing`, { linkAccess }),
  addMember: (id: string, username: string, role: MemberRole) =>
    request<SharingInfo>('POST', `/files/${id}/members`, { username, role }),
  updateMember: (id: string, userId: string, role: MemberRole) =>
    request<SharingInfo>('PATCH', `/files/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => request<SharingInfo>('DELETE', `/files/${id}/members/${userId}`),

  versions: (id: string) => request<{ versions: VersionMeta[] }>('GET', `/files/${id}/versions`),
  saveVersion: (id: string, name?: string) => request<{ version: VersionMeta }>('POST', `/files/${id}/versions`, { name }),
  renameVersion: (id: string, versionId: string, name: string | null) =>
    request<{ versions: VersionMeta[] }>('PATCH', `/files/${id}/versions/${versionId}`, { name }),
  async versionState(id: string, versionId: string): Promise<Uint8Array> {
    const response = await fetch(`/api/files/${id}/versions/${versionId}`, { credentials: 'same-origin' });
    if (!response.ok) throw new ApiError(response.status, 'Could not load this version.');
    return new Uint8Array(await response.arrayBuffer());
  },

  pages: (workspaceId: string) => request<{ pages: FileMeta[] }>('GET', `/files/${workspaceId}/pages`),
  trashedPages: (workspaceId: string) => request<{ pages: FileMeta[] }>('GET', `/files/${workspaceId}/trashed-pages`),
  searchUsers: (q: string) => request<{ users: PublicUser[] }>('GET', `/users${query({ q })}`),

  async upload(file: Blob): Promise<string> {
    const response = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !data.url) throw new ApiError(response.status, data.error ?? 'Upload failed');
    return data.url;
  },
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';
