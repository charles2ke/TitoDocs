import { useCallback, useEffect, useState } from 'react';
import type { FileDetails, FileMeta, StatelessMessage } from '@shared/types';
import { ApiError, api } from '../api';
import { useStateless, type Room } from '../collab';

export interface FileState {
  file: FileMeta | null;
  workspace: FileMeta | null;
  error: ApiError | null;
  /** The file was trashed or deleted while open. */
  deleted: boolean;
  setFile(update: (file: FileMeta) => FileMeta): void;
  reload(): Promise<void>;
}

/** Loads a file's metadata over REST. */
export function useFile(id: string): FileState {
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleted, setDeleted] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api.getFile(id);
      setDetails(next);
      setError(null);
      setDeleted(!!next.file.trashedAt);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)));
    }
  }, [id]);

  useEffect(() => {
    setDetails(null);
    setError(null);
    setDeleted(false);
    void reload();
  }, [reload]);

  const setFile = useCallback(
    (update: (file: FileMeta) => FileMeta) => setDetails((previous) => previous && { ...previous, file: update(previous.file) }),
    [],
  );

  return {
    file: details?.file.id === id ? details.file : null,
    workspace: details?.workspace ?? null,
    error,
    deleted,
    setFile,
    reload,
  };
}

/** Applies live title/metadata changes and deletion notices that the server sends over the file's room. */
export function useLiveFile(state: FileState, room: Room | null, onTree?: () => void): void {
  const { setFile, reload } = state;
  const handler = useCallback(
    (message: StatelessMessage) => {
      if (message.type === 'meta') setFile((file) => ({ ...file, ...message.file, id: file.id }));
      else if (message.type === 'access') void reload();
      else if (message.type === 'tree') onTree?.();
    },
    [setFile, reload, onTree],
  );
  useStateless(room, handler);
}
