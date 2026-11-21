import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Ban, Eye, FilePlus, FileQuestion, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from 'lucide-react';
import { canComment, canEdit, commentsDocName, type FileMeta } from '@shared/types';
import { api } from '../api';
import { useUser } from '../auth';
import { usePresence, useRoom, useRoomStatus, type AwarenessUser, type Room } from '../collab';
import { AppHeader } from '../components/AppHeader';
import { useToast } from '../components/Toast';
import { EmptyState, FileTypeIcon, Spinner } from '../components/ui';
import { useFile, useLiveFile, type FileState } from '../lib/useFile';
import { absoluteUrl, fileUrl, useLocalStorage } from '../lib/util';
import { FileGate, TrashedBanner } from '../pages/FileGate';
import { markFresh } from './context';
import { EmojiPicker } from './EmojiPicker';
import { PageEditor } from './PageEditor';
import { PageTree, TrashedPagesDialog } from './PageTree';
import { applyMoves, isWithin, parentIdOf, siblingsOf, type PageMove } from './tree';
import '../editor/editor.css';
import './loop.css';

export default function WorkspacePage() {
  const { id = '', pageId } = useParams();
  const state = useFile(id);
  return (
    <FileGate state={state} expect={['workspace']}>
      {(workspace) => <WorkspaceView key={workspace.id} state={state} workspace={workspace} pageId={pageId ?? null} />}
    </FileGate>
  );
}

/** Who has which page open, from the workspace room's presence (the current user is left out). */
function usePagePresence(room: Room | null, pageId: string | null): Map<string, AwarenessUser[]> {
  const user = useUser();
  const [byPage, setByPage] = useState(() => new Map<string, AwarenessUser[]>());

  useEffect(() => {
    room?.provider.setAwarenessField('page', pageId);
  }, [room, pageId]);

  useEffect(() => {
    const awareness = room?.provider.awareness;
    if (!awareness) return;
    const update = () => {
      const next = new Map<string, AwarenessUser[]>();
      for (const [clientId, state] of awareness.getStates()) {
        const { user: person, page } = state as { user?: AwarenessUser; page?: unknown };
        if (!person?.id || typeof page !== 'string' || clientId === awareness.clientID || person.id === user.id) continue;
        const list = next.get(page) ?? [];
        if (!list.some((other) => other.id === person.id)) next.set(page, [...list, person]);
      }
      setByPage(next);
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [room, user.id]);

  return byPage;
}

const NARROW = '(max-width: 760px)';

function WorkspaceView({ state, workspace, pageId }: { state: FileState; workspace: FileMeta; pageId: string | null }) {
  const toast = useToast();
  const navigate = useNavigate();
  const wsRoom = useRoom(workspace.id);
  const [pages, setPages] = useState<FileMeta[] | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [storedSidebar, setStoredSidebar] = useLocalStorage('loop-sidebar', true);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const sidebarOpen = narrow ? mobileSidebar : storedSidebar;
  const canEditWorkspace = canEdit(workspace.role) && !workspace.trashedAt;

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => setMobileSidebar(false), [pageId]);

  const toggleSidebar = () => (narrow ? setMobileSidebar((open) => !open) : setStoredSidebar((open) => !open));

  // ---------------------------------------------------------------- pages

  // Only the latest request may update the list, so a slow response can't bring back an older tree.
  const requests = useRef(0);
  const loadPages = useCallback(async () => {
    const request = ++requests.current;
    try {
      const { pages: next } = await api.pages(workspace.id);
      if (request === requests.current) setPages(next);
    } catch (error) {
      if (request !== requests.current) return;
      toast.error(error);
      setPages((current) => current ?? []);
    }
  }, [workspace.id, toast]);
  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  // While moves are being saved one by one, reloading would show the tree half moved.
  const moving = useRef(0);
  const onTree = useCallback(() => {
    if (moving.current === 0) void loadPages();
  }, [loadPages]);
  useLiveFile(state, wsRoom, onTree);

  // Changes made while disconnected were not announced to this browser.
  const wsStatus = useRoomStatus(wsRoom);
  const wasConnected = useRef(false);
  useEffect(() => {
    if (wsStatus.status !== 'connected') return;
    if (wasConnected.current) void loadPages();
    wasConnected.current = true;
  }, [wsStatus.status, loadPages]);

  const presence = usePagePresence(wsRoom, pageId);
  const current = pages?.find((page) => page.id === pageId) ?? null;
  const pageRoom = useRoom(current ? current.id : null);
  const status = useRoomStatus(pageRoom ?? wsRoom);
  const people = usePresence(pageRoom);

  useEffect(() => {
    document.title = `${current ? `${current.title} – ` : ''}${workspace.title} - TitoDocs`;
    return () => {
      document.title = 'TitoDocs';
    };
  }, [current, workspace.title]);

  const patchPage = useCallback(
    (id: string, patch: Partial<Pick<FileMeta, 'title' | 'icon'>>) =>
      setPages((list) => list && list.map((page) => (page.id === id ? { ...page, ...patch } : page))),
    [],
  );

  const addPage = async (parentId: string | null, title?: string): Promise<FileMeta> => {
    const { file: page } = await api.createFile({ type: 'page', workspaceId: workspace.id, parentId, title });
    setPages((list) => (list && !list.some((existing) => existing.id === page.id) ? [...list, page] : list));
    return page;
  };

  const createPage = async (parentId: string | null) => {
    try {
      const page = await addPage(parentId);
      markFresh(page.id);
      navigate(fileUrl(page));
    } catch (error) {
      toast.error(error);
    }
  };

  const movePages = async (moves: PageMove[]) => {
    if (!moves.length) return;
    setPages((list) => list && applyMoves(list, moves));
    moving.current += 1;
    try {
      for (const move of moves) await api.updateFile(move.id, { parentId: move.parentId, position: move.position });
    } catch (error) {
      toast.error(error);
    } finally {
      moving.current -= 1;
      if (moving.current === 0) void loadPages();
    }
  };

  const renamePage = async (page: FileMeta, title: string) => {
    patchPage(page.id, { title });
    try {
      await api.updateFile(page.id, { title });
    } catch (error) {
      toast.error(error);
      void loadPages();
    }
  };

  const copyLink = async (page: FileMeta) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(fileUrl(page)));
      toast.show('Link copied', { kind: 'success' });
    } catch {
      toast.show('Could not copy the link. Copy it from the address bar instead.', { kind: 'error' });
    }
  };

  const trashPage = async (page: FileMeta) => {
    const list = pages ?? [];
    const openInside = !!pageId && isWithin(list, pageId, page.id);
    try {
      await api.trash(page.id);
    } catch (error) {
      toast.error(error);
      return;
    }
    const remaining = list.filter((other) => !isWithin(list, other.id, page.id));
    setPages((existing) => existing && existing.filter((other) => !isWithin(existing, other.id, page.id)));
    if (openInside) {
      const parentId = parentIdOf(list, page.id);
      const next = remaining.find((other) => other.id === parentId) ?? siblingsOf(remaining, null)[0];
      navigate(next ? fileUrl(next) : fileUrl(workspace), { replace: true });
    }
    toast.show(`“${page.title}” was moved to the trash`, {
      action: {
        label: 'Undo',
        onClick: () =>
          void api.restore(page.id).then(() => {
            void loadPages();
            if (openInside) navigate(fileUrl(page));
          }, toast.error),
      },
    });
  };

  const setWorkspaceIcon = async (icon: string | null) => {
    try {
      const { file } = await api.updateFile(workspace.id, { icon });
      state.setFile((existing) => ({ ...existing, icon: file.icon }));
    } catch (error) {
      toast.error(error);
    }
  };

  // ---------------------------------------------------------------- layout

  const sidebarToggle = (
    <button
      type="button"
      className="icon-btn loop-sidebar-toggle"
      aria-label={sidebarOpen ? 'Hide pages' : 'Show pages'}
      aria-expanded={sidebarOpen}
      aria-controls="loop-sidebar"
      title={sidebarOpen ? 'Hide pages' : 'Show pages'}
      onClick={toggleSidebar}
    >
      {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
    </button>
  );

  let main;
  if (!pages) {
    main = (
      <div className="loop-center">
        <Spinner label="Loading pages" />
      </div>
    );
  } else if (!pageId) {
    const first = siblingsOf(pages, null)[0];
    main = first ? (
      <Navigate to={fileUrl(first)} replace />
    ) : (
      <>
        <div className="page-toolbar no-print">{sidebarToggle}</div>
        <div className="loop-center">
          <EmptyState icon={<FilePlus size={40} />} title="This workspace has no pages yet">
            {canEditWorkspace ? (
              <button type="button" className="btn btn-primary" onClick={() => void createPage(null)}>
                <Plus size={16} /> New page
              </button>
            ) : (
              'Pages added to this workspace will appear here.'
            )}
          </EmptyState>
        </div>
      </>
    );
  } else {
    main = (
      <PageView
        key={pageId}
        pageId={pageId}
        workspace={workspace}
        pages={pages}
        sidebarToggle={sidebarToggle}
        onPatched={patchPage}
        onAddSubpage={addPage}
        onCopyLink={(page) => void copyLink(page)}
        onTrash={(page) => void trashPage(page)}
      />
    );
  }

  return (
    <div className="loop-page">
      <AppHeader
        file={workspace}
        status={status}
        people={people}
        onFileChange={state.setFile}
        icon={
          canEditWorkspace ? (
            <EmojiPicker value={workspace.icon} onChange={(icon) => void setWorkspaceIcon(icon)}>
              {(props) => (
                <button type="button" className="icon-btn loop-workspace-icon" aria-label="Change workspace icon" title="Change icon" {...props}>
                  <FileTypeIcon type="workspace" icon={workspace.icon} size={24} />
                </button>
              )}
            </EmojiPicker>
          ) : (
            <FileTypeIcon type="workspace" icon={workspace.icon} size={24} />
          )
        }
      />
      <TrashedBanner file={workspace} onRestored={() => void state.reload()} />
      {wsStatus.denied && (
        <div className="banner banner-warning" role="alert">
          <Ban size={16} />
          <span>You no longer have access to this workspace.</span>
        </div>
      )}
      {!canEdit(workspace.role) && !workspace.trashedAt && !wsStatus.denied && (
        <div className="banner banner-info no-print" data-testid="access-banner">
          {canComment(workspace.role) ? <MessageSquare size={16} /> : <Eye size={16} />}
          <span>
            {canComment(workspace.role)
              ? 'You can view and comment on the pages in this workspace, but not edit them.'
              : 'You can view the pages in this workspace, but not edit them or comment.'}
          </span>
        </div>
      )}
      <div className={`loop-body ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {sidebarOpen && (
          <aside className="loop-sidebar no-print" id="loop-sidebar" aria-label="Workspace pages">
            <div className="loop-sidebar-head">
              <span className="loop-sidebar-label">Pages</span>
              {canEditWorkspace && (
                <button type="button" className="icon-btn icon-btn-sm" aria-label="New page" title="New page" onClick={() => void createPage(null)}>
                  <Plus size={16} />
                </button>
              )}
            </div>
            {pages ? (
              <PageTree
                workspaceId={workspace.id}
                pages={pages}
                currentId={pageId}
                presence={presence}
                editable={canEditWorkspace}
                onCreate={(parentId) => void createPage(parentId)}
                onMove={(moves) => void movePages(moves)}
                onRename={(page, title) => void renamePage(page, title)}
                onTrash={(page) => void trashPage(page)}
                onCopyLink={(page) => void copyLink(page)}
              />
            ) : (
              <Spinner label="Loading pages" />
            )}
            {canEditWorkspace && (
              <div className="loop-sidebar-foot">
                <button type="button" className="btn btn-link" onClick={() => setShowTrash(true)}>
                  <Trash2 size={15} /> Recently deleted
                </button>
              </div>
            )}
          </aside>
        )}
        {narrow && sidebarOpen && <div className="loop-sidebar-scrim" aria-hidden="true" onClick={() => setMobileSidebar(false)} />}
        <main className="loop-main">{main}</main>
      </div>
      {showTrash && (
        <TrashedPagesDialog
          workspace={workspace}
          canRestore={canEditWorkspace}
          onRestored={() => void loadPages()}
          onClose={() => setShowTrash(false)}
        />
      )}
    </div>
  );
}

interface PageViewProps {
  pageId: string;
  workspace: FileMeta;
  pages: FileMeta[];
  sidebarToggle: ReactNode;
  onPatched: (id: string, patch: Partial<Pick<FileMeta, 'title' | 'icon'>>) => void;
  onAddSubpage: (parentId: string, title: string) => Promise<FileMeta>;
  onCopyLink: (page: FileMeta) => void;
  onTrash: (page: FileMeta) => void;
}

/** Loads the open page, then joins its rooms. */
function PageView({ pageId, workspace, ...props }: PageViewProps) {
  const state = useFile(pageId);
  const { file, error } = state;
  if (error) {
    return (
      <>
        <div className="page-toolbar no-print">{props.sidebarToggle}</div>
        <div className="loop-center">
          <EmptyState icon={<FileQuestion size={40} />} title="Page not found">
            {error.status === 404 ? 'This page was deleted, or you do not have access to it.' : error.message}
          </EmptyState>
        </div>
      </>
    );
  }
  if (!file) {
    return (
      <div className="loop-center">
        <Spinner label="Loading page" />
      </div>
    );
  }
  if (file.type !== 'page' || file.workspaceId !== workspace.id) return <Navigate to={fileUrl(file)} replace />;
  return <PageRooms state={state} file={file} workspace={workspace} {...props} />;
}

function PageRooms({ state, file, workspace, ...props }: Omit<PageViewProps, 'pageId'> & { state: FileState; file: FileMeta }) {
  const room = useRoom(file.id);
  const commentsRoom = useRoom(commentsDocName(file.id));
  if (!room || !commentsRoom) {
    return (
      <div className="loop-center">
        <Spinner label="Loading page" />
      </div>
    );
  }
  return <PageEditor state={state} file={file} workspace={workspace} room={room} commentsRoom={commentsRoom} {...props} />;
}
