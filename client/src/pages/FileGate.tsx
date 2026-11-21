import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { FileQuestion, RotateCcw, Trash2 } from 'lucide-react';
import type { FileMeta, FileType } from '@shared/types';
import { api } from '../api';
import { useUser } from '../auth';
import { useToast } from '../components/Toast';
import { FullPageSpinner, Logo } from '../components/ui';
import { fileUrl } from '../lib/util';
import type { FileState } from '../lib/useFile';

export function NotFound({ message }: { message?: string }) {
  const user = useUser();
  return (
    <main className="not-found">
      <Logo size={48} />
      <FileQuestion size={56} className="muted" />
      <h1>File not found</h1>
      <p className="muted">
        {message ?? 'This file does not exist, was deleted, or you do not have access to it.'} You are signed in as{' '}
        <strong>@{user.username}</strong> – ask the owner to share it with you.
      </p>
      <Link className="btn btn-primary" to="/">
        Go to TitoDocs home
      </Link>
    </main>
  );
}

interface FileGateProps {
  state: FileState;
  expect: FileType[];
  children: (file: FileMeta) => ReactNode;
}

/** Shows loading and error states, and redirects when a link points at the wrong kind of editor. */
export function FileGate({ state, expect, children }: FileGateProps) {
  if (state.error) return <NotFound message={state.error.status === 404 ? undefined : state.error.message} />;
  if (!state.file) return <FullPageSpinner />;
  if (!expect.includes(state.file.type)) return <Navigate to={fileUrl(state.file)} replace />;
  return <>{children(state.file)}</>;
}

export function TrashedBanner({ file, onRestored }: { file: FileMeta; onRestored: () => void }) {
  const toast = useToast();
  if (!file.trashedAt) return null;
  return (
    <div className="banner banner-warning" role="alert">
      <Trash2 size={16} />
      <span>This file is in the trash, so it can't be edited.</span>
      <button
        className="btn btn-sm"
        onClick={async () => {
          try {
            await api.restore(file.id);
            onRestored();
          } catch (error) {
            toast.error(error);
          }
        }}
      >
        <RotateCcw size={14} /> Restore
      </button>
    </div>
  );
}
