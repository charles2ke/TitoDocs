import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CircleAlert, Ellipsis, ExternalLink, Link2, Lock, Trash2 } from 'lucide-react';
import { canEdit, type ComponentType, type FileMeta } from '@shared/types';
import { api } from '../api';
import { usePresence, useRoom, useRoomStatus, whenSynced, type Room } from '../collab';
import { TitleInput } from '../components/AppHeader';
import { Dropdown, separator } from '../components/Menu';
import { useToast } from '../components/Toast';
import { Avatar, Spinner } from '../components/ui';
import { useFile, useLiveFile, type FileState } from '../lib/useFile';
import { absoluteUrl, fileUrl } from '../lib/util';
import { componentInfo } from './componentTypes';
import { clearFresh, isFresh } from './context';
import { ProgressView } from './ProgressView';
import { QnaView } from './QnaView';
import { RichView } from './RichView';
import type { ComponentViewProps } from './rows';
import { TasksView } from './TasksView';
import { VotingView } from './VotingView';

/** Connects to a component's room once its details have loaded. */
export function useComponentRoom(state: FileState) {
  const { file, error } = state;
  const room = useRoom(file && !error ? file.id : null);
  const status = useRoomStatus(room);
  const people = usePresence(room);
  useLiveFile(state, room);

  // Stays true while offline: changes made then are sent on reconnect.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    void whenSynced(room).then(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [room]);

  useEffect(() => {
    if (!status.unsynced) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status.unsynced]);

  const editable = !!file && loaded && canEdit(file.role) && !file.trashedAt && !status.denied;
  return { room, status, people, loaded, editable };
}

const VIEWS: Record<ComponentType, (props: ComponentViewProps) => ReactNode> = {
  tasks: TasksView,
  progress: ProgressView,
  voting: VotingView,
  qna: QnaView,
  rich: RichView,
};

/** The content of a component, which depends on its type. */
export function ComponentBody({ file, room, editable, variant }: { file: FileMeta; room: Room; editable: boolean; variant: 'card' | 'page' }) {
  const [autoFocus, setAutoFocus] = useState(() => isFresh(file.id));
  const View = VIEWS[file.componentType ?? 'rich'] ?? RichView;
  const onAutoFocused = () => {
    clearFresh(file.id);
    setAutoFocus(false);
  };
  return <View room={room} editable={editable} autoFocus={autoFocus} onAutoFocused={onAutoFocused} variant={variant} />;
}

export function useCopyComponentLink() {
  const toast = useToast();
  return async (file: FileMeta) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(fileUrl(file)));
      toast.show('Link copied. Paste it on another page to show this live component there too.', { kind: 'success' });
    } catch {
      toast.show('Could not copy the link. Copy it from the address bar of the full view instead.', { kind: 'error' });
    }
  };
}

interface ComponentCardProps {
  id: string;
  selected: boolean;
  /**
   * Shows the component without editing, because the page around it is read-only. A read-only ProseMirror view
   * claims any text selection inside it, which would fight with the fields of an editable card.
   */
  readOnly: boolean;
  /** Removes the card from the page; only given when the page can be edited. */
  onRemove?: () => void;
  /** Reports the component's type (pasted links do not know it yet). */
  onType?: (type: ComponentType) => void;
}

/** A live Loop component embedded in a page. Every copy of it, anywhere, shows the same content. */
export function ComponentCard({ id, selected, readOnly, onRemove, onType }: ComponentCardProps) {
  const state = useFile(id);
  const { file, error } = state;
  const { room, people, loaded, editable: canEditComponent, status } = useComponentRoom(state);
  const editable = canEditComponent && !readOnly;
  const toast = useToast();
  const copyLink = useCopyComponentLink();

  const reportType = useEffectEvent((type: ComponentType) => onType?.(type));
  const type = file?.type === 'component' ? (file.componentType ?? 'rich') : null;
  useEffect(() => {
    if (type && !readOnly) reportType(type);
  }, [type, readOnly]);

  if (error) {
    const message =
      error.status === 404
        ? 'This Loop component was deleted.'
        : error.status === 403
          ? 'You do not have access to this Loop component.'
          : error.message;
    return <CardMessage icon={error.status === 403 ? <Lock size={16} /> : <CircleAlert size={16} />} message={message} selected={selected} onRemove={onRemove} />;
  }
  if (!file) {
    return (
      <div className={`loop-card loop-card-message ${selected ? 'is-selected' : ''}`}>
        <Spinner label="Loading component" />
      </div>
    );
  }
  if (file.type !== 'component') {
    return <CardMessage icon={<CircleAlert size={16} />} message="This link is not a Loop component." selected={selected} onRemove={onRemove} />;
  }

  const info = componentInfo(file.componentType);
  const rename = async (title: string) => {
    try {
      const { file: updated } = await api.updateFile(file.id, { title });
      state.setFile((current) => ({ ...current, title: updated.title }));
    } catch (caught) {
      toast.error(caught);
    }
  };

  return (
    <div className={`loop-card ${selected ? 'is-selected' : ''}`} data-testid="loop-card" data-component-type={file.componentType ?? 'rich'}>
      <div className="loop-card-header">
        <span className="loop-card-type" title={`${info.label} (Loop component)`}>
          <info.icon size={16} aria-hidden />
        </span>
        <span className="loop-card-title" data-loop-interactive>
          <TitleInput title={file.title} editable={canEdit(file.role) && !file.trashedAt && !readOnly} onRename={rename} label="Component name" />
        </span>
        <span className="loop-card-actions" data-loop-interactive>
          {people.length > 0 && (
            <span className="loop-card-people" aria-label={`${people.length} other ${people.length === 1 ? 'person' : 'people'} here`}>
              {people.slice(0, 3).map((person) => (
                <Avatar key={person.id} user={person} size={22} />
              ))}
              {people.length > 3 && <span className="avatar avatar-more">+{people.length - 3}</span>}
            </span>
          )}
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Copy component link" title="Copy link" onClick={() => void copyLink(file)}>
            <Link2 size={16} />
          </button>
          <Link className="icon-btn icon-btn-sm" to={fileUrl(file)} aria-label="Open in full view" title="Open in full view">
            <ExternalLink size={16} />
          </Link>
          {onRemove && (
            <Dropdown
              align="end"
              label="Component options"
              trigger={(props) => (
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Component options" title="More options" {...props}>
                  <Ellipsis size={16} />
                </button>
              )}
              items={[
                { label: 'Copy link', icon: <Link2 size={16} />, onSelect: () => void copyLink(file) },
                separator,
                { label: 'Remove from page', icon: <Trash2 size={16} />, danger: true, onSelect: onRemove },
              ]}
            />
          )}
        </span>
      </div>
      {file.trashedAt && <p className="loop-card-note">This component is in the trash, so it can't be edited.</p>}
      {!file.trashedAt && status.denied && <p className="loop-card-note">You no longer have access to this component.</p>}
      <div className="loop-card-body" data-loop-interactive>
        {room && loaded ? <ComponentBody file={file} room={room} editable={editable} variant="card" /> : <Spinner label="Loading component" />}
      </div>
    </div>
  );
}

function CardMessage({ icon, message, selected, onRemove }: { icon: ReactNode; message: string; selected: boolean; onRemove?: () => void }) {
  return (
    <div className={`loop-card loop-card-message ${selected ? 'is-selected' : ''}`} role="note">
      {icon}
      <span>{message}</span>
      {onRemove && (
        <button type="button" className="btn btn-sm" data-loop-interactive onClick={onRemove}>
          Remove from page
        </button>
      )}
    </div>
  );
}
