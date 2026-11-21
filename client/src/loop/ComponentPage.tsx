import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Ban, Eye, Link2 } from 'lucide-react';
import { canEdit, type FileMeta } from '@shared/types';
import { AppHeader } from '../components/AppHeader';
import { Spinner } from '../components/ui';
import { useFile, type FileState } from '../lib/useFile';
import { FileGate, TrashedBanner } from '../pages/FileGate';
import { ComponentBody, useComponentRoom, useCopyComponentLink } from './ComponentCard';
import { componentInfo } from './componentTypes';
import '../editor/editor.css';
import './loop.css';

/** A Loop component on its own, as opened from its link. */
export default function ComponentPage() {
  const { id = '' } = useParams();
  const state = useFile(id);
  return (
    <FileGate state={state} expect={['component']}>
      {(file) => <ComponentView key={file.id} state={state} file={file} />}
    </FileGate>
  );
}

function ComponentView({ state, file }: { state: FileState; file: FileMeta }) {
  const { room, status, people, loaded, editable } = useComponentRoom(state);
  const copyLink = useCopyComponentLink();
  const info = componentInfo(file.componentType);

  useEffect(() => {
    document.title = `${file.title} - TitoDocs`;
    return () => {
      document.title = 'TitoDocs';
    };
  }, [file.title]);

  return (
    <div className="component-page">
      <AppHeader
        file={file}
        status={status}
        people={people}
        onFileChange={state.setFile}
        star={false}
        icon={<info.icon size={26} aria-hidden />}
        actions={
          <button type="button" className="btn" onClick={() => void copyLink(file)}>
            <Link2 size={16} /> Copy link
          </button>
        }
      />
      <TrashedBanner file={file} onRestored={() => void state.reload()} />
      {status.denied && (
        <div className="banner banner-warning" role="alert">
          <Ban size={16} />
          <span>You no longer have access to this component.</span>
        </div>
      )}
      {!canEdit(file.role) && !file.trashedAt && !status.denied && (
        <div className="banner banner-info no-print" data-testid="access-banner">
          <Eye size={16} />
          <span>You can view this component, but not edit it.</span>
        </div>
      )}
      <main className="component-main">
        <div className="component-sheet" data-component-type={file.componentType ?? 'rich'}>
          <p className="component-kind">
            <info.icon size={16} aria-hidden /> {info.label} · Loop component
          </p>
          {room && loaded ? <ComponentBody file={file} room={room} editable={editable} variant="page" /> : <Spinner label="Loading component" />}
        </div>
        <p className="component-hint no-print">
          Everyone sees the same content wherever this component is shared. Copy its link and paste it on a Loop page to show it there
          too.
        </p>
      </main>
    </div>
  );
}
