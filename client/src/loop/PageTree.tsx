import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Ellipsis,
  FilePlus,
  IndentDecrease,
  IndentIncrease,
  Link2,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { FileMeta } from '@shared/types';
import { api } from '../api';
import type { AwarenessUser } from '../collab';
import { Dialog } from '../components/Dialog';
import { Dropdown, separator, type MenuEntry } from '../components/Menu';
import { useToast } from '../components/Toast';
import { Avatar, EmptyState, FileTypeIcon, Spinner } from '../components/ui';
import { fileUrl, formatTime, useLocalStorage } from '../lib/util';
import { ancestors, buildTree, isWithin, parentIdOf, planMove, siblingsOf, type PageMove, type PageNode } from './tree';

type DropZone = 'before' | 'inside' | 'after';
const DRAG_TYPE = 'application/x-titodocs-page';

interface PageTreeProps {
  workspaceId: string;
  pages: FileMeta[];
  currentId: string | null;
  /** Other people in the workspace, by the page they have open. */
  presence: Map<string, AwarenessUser[]>;
  editable: boolean;
  onCreate: (parentId: string | null) => void;
  onMove: (moves: PageMove[]) => void;
  onRename: (page: FileMeta, title: string) => void;
  onTrash: (page: FileMeta) => void;
  onCopyLink: (page: FileMeta) => void;
}

/** The workspace's pages and subpages, which can be reordered by dragging them (or with each page's menu). */
export function PageTree({ workspaceId, pages, currentId, presence, editable, onCreate, onMove, onRename, onTrash, onCopyLink }: PageTreeProps) {
  const tree = useMemo(() => buildTree(pages), [pages]);
  const [collapsed, setCollapsed] = useLocalStorage<string[]>(`loop-collapsed:${workspaceId}`, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string | null; zone: DropZone } | null>(null);

  const expand = (id: string) => setCollapsed((list) => list.filter((candidate) => candidate !== id));
  const toggle = (id: string) => setCollapsed((list) => (list.includes(id) ? list.filter((candidate) => candidate !== id) : [...list, id]));

  // Keep the open page visible when it is inside collapsed pages.
  useEffect(() => {
    if (!currentId) return;
    const above = new Set(ancestors(pages, currentId).map((page) => page.id));
    setCollapsed((list) => (list.some((id) => above.has(id)) ? list.filter((id) => !above.has(id)) : list));
  }, [currentId, pages, setCollapsed]);

  const moveTo = (page: FileMeta, parentId: string | null, index: number) => {
    if (parentId && isWithin(pages, parentId, page.id)) return;
    if (parentId) expand(parentId);
    onMove(planMove(pages, page.id, parentId, index));
  };

  const menuFor = (page: FileMeta): MenuEntry[] => {
    const copy: MenuEntry = { label: 'Copy link', icon: <Link2 size={16} />, onSelect: () => onCopyLink(page) };
    if (!editable) return [copy];
    const parentId = parentIdOf(pages, page.id);
    const siblings = siblingsOf(pages, parentId);
    const index = siblings.findIndex((sibling) => sibling.id === page.id);
    const previous = siblings[index - 1];
    const outdent = () => {
      if (!parentId) return;
      const grandparentId = parentIdOf(pages, parentId);
      moveTo(page, grandparentId, siblingsOf(pages, grandparentId).findIndex((sibling) => sibling.id === parentId) + 1);
    };
    return [
      { label: 'Add subpage', icon: <FilePlus size={16} />, onSelect: () => onCreate(page.id) },
      { label: 'Rename', icon: <PenLine size={16} />, onSelect: () => setRenaming(page.id) },
      copy,
      separator,
      { label: 'Move up', icon: <ArrowUp size={16} />, disabled: index <= 0, onSelect: () => moveTo(page, parentId, index - 1) },
      { label: 'Move down', icon: <ArrowDown size={16} />, disabled: index >= siblings.length - 1, onSelect: () => moveTo(page, parentId, index + 1) },
      {
        label: 'Nest under the page above',
        icon: <IndentIncrease size={16} />,
        disabled: !previous,
        onSelect: () => previous && moveTo(page, previous.id, siblingsOf(pages, previous.id).length),
      },
      { label: 'Move out one level', icon: <IndentDecrease size={16} />, disabled: !parentId, onSelect: outdent },
      separator,
      { label: 'Move to trash', icon: <Trash2 size={16} />, danger: true, onSelect: () => onTrash(page), testId: 'trash-page' },
    ];
  };

  // ---------------------------------------------------------------- drag and drop

  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };

  const onDragOver = (event: DragEvent<HTMLElement>, target: FileMeta | null) => {
    if (!dragging || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    if (target && isWithin(pages, target.id, dragging)) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    let zone: DropZone = 'after';
    if (target) {
      const rect = event.currentTarget.getBoundingClientRect();
      const offset = (event.clientY - rect.top) / rect.height;
      zone = offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
    }
    const id = target?.id ?? null;
    setDrop((current) => (current?.id === id && current.zone === zone ? current : { id, zone }));
  };

  const onDrop = (event: DragEvent<HTMLElement>, target: FileMeta | null) => {
    const page = pages.find((candidate) => candidate.id === dragging);
    const zone = drop?.zone;
    endDrag();
    if (!page || !zone || (target && isWithin(pages, target.id, page.id))) return;
    event.preventDefault();
    if (!target) {
      moveTo(page, null, siblingsOf(pages, null).filter((sibling) => sibling.id !== page.id).length);
      return;
    }
    const children = siblingsOf(pages, target.id).filter((child) => child.id !== page.id);
    if (zone === 'inside') {
      moveTo(page, target.id, children.length);
    } else if (zone === 'after' && children.length && !collapsed.includes(target.id)) {
      // Dropping just below an expanded page puts the page first among the subpages shown there.
      moveTo(page, target.id, 0);
    } else {
      const parentId = parentIdOf(pages, target.id);
      const siblings = siblingsOf(pages, parentId).filter((sibling) => sibling.id !== page.id);
      const index = siblings.findIndex((sibling) => sibling.id === target.id);
      moveTo(page, parentId, zone === 'before' ? index : index + 1);
    }
  };

  // ---------------------------------------------------------------- rows

  const renderNode = ({ page, depth, children }: PageNode): ReactNode => {
    const open = !collapsed.includes(page.id);
    const current = page.id === currentId;
    const here = presence.get(page.id) ?? [];
    const zone = drop?.id === page.id ? drop.zone : null;
    const title = page.title || 'Untitled page';
    return (
      <li key={page.id} className="page-item">
        <div
          className={`page-row ${current ? 'is-current' : ''} ${dragging === page.id ? 'is-dragging' : ''} ${zone ? `drop-${zone}` : ''}`}
          style={{ paddingInlineStart: `${4 + depth * 14}px` }}
          draggable={editable && renaming !== page.id}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, page.id);
            event.dataTransfer.effectAllowed = 'move';
            setDragging(page.id);
          }}
          onDragOver={(event) => onDragOver(event, page)}
          onDrop={(event) => onDrop(event, page)}
          onDragEnd={endDrag}
          data-page-id={page.id}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className={`page-toggle icon-btn icon-btn-sm ${open ? 'is-open' : ''}`}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
              onClick={() => toggle(page.id)}
            >
              <ChevronRight size={14} />
            </button>
          ) : (
            <span className="page-toggle" aria-hidden="true" />
          )}
          {renaming === page.id ? (
            <RenameInput
              title={page.title}
              onDone={(next, fromKeyboard) => {
                setRenaming(null);
                if (next) onRename(page, next);
                if (fromKeyboard) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-page-id="${page.id}"] .page-link`)?.focus());
              }}
            />
          ) : (
            <Link className="page-link" to={fileUrl(page)} aria-current={current ? 'page' : undefined} draggable={false}>
              <span className="page-icon">
                <FileTypeIcon type="page" icon={page.icon} size={15} />
              </span>
              <span className="page-row-title">{title}</span>
            </Link>
          )}
          {here.length > 0 && (
            <span className="page-presence" title={`Here now: ${here.map((person) => person.name).join(', ')}`}>
              {here.slice(0, 3).map((person) => (
                <Avatar key={person.id} user={person} size={18} />
              ))}
              <span className="visually-hidden">{`${here.length} ${here.length === 1 ? 'person' : 'people'} on this page`}</span>
            </span>
          )}
          <span className="page-row-actions">
            {editable && (
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Add a subpage to ${title}`} title="Add a subpage" onClick={() => onCreate(page.id)}>
                <Plus size={15} />
              </button>
            )}
            <Dropdown
              align="end"
              label={`${title} options`}
              items={() => menuFor(page)}
              trigger={(props) => (
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`${title} options`} title="More options" {...props}>
                  <Ellipsis size={15} />
                </button>
              )}
            />
          </span>
        </div>
        {children.length > 0 && open && <ul className="page-children">{children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <nav className="page-tree" aria-label="Pages" onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setDrop(null)}>
      {tree.length > 0 ? <ul className="page-list">{tree.map(renderNode)}</ul> : <p className="muted page-tree-empty">No pages yet.</p>}
      {editable && (
        <div
          className={`page-tree-end ${dragging ? 'is-active' : ''} ${drop && drop.id === null ? 'drop-after' : ''}`}
          onDragOver={(event) => onDragOver(event, null)}
          onDrop={(event) => onDrop(event, null)}
        >
          <button type="button" className="btn btn-link page-tree-add" onClick={() => onCreate(null)}>
            <Plus size={15} /> New page
          </button>
        </div>
      )}
    </nav>
  );
}

function RenameInput({ title, onDone }: { title: string; onDone: (title: string | null, fromKeyboard: boolean) => void }) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null, fromKeyboard = false) => {
    if (done.current) return;
    done.current = true;
    const trimmed = next?.trim();
    onDone(trimmed && trimmed !== title ? trimmed : null, fromKeyboard);
  };
  return (
    <input
      className="page-rename"
      aria-label="Page name"
      value={value}
      autoFocus
      maxLength={200}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value, true);
        else if (event.key === 'Escape') {
          event.stopPropagation();
          finish(null, true);
        }
      }}
    />
  );
}

/** Pages moved to the trash from this workspace, which can be restored. */
export function TrashedPagesDialog({
  workspace,
  canRestore,
  onRestored,
  onClose,
}: {
  workspace: FileMeta;
  canRestore: boolean;
  onRestored: (page: FileMeta) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [trashed, setTrashed] = useState<FileMeta[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrashed((await api.trashedPages(workspace.id)).pages);
    } catch (error) {
      toast.error(error);
      setTrashed((current) => current ?? []);
    }
  }, [workspace.id, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  // Subpages trashed together with their parent come back with it, so only the parent is listed.
  const trashedWith = (page: FileMeta, list: FileMeta[]) =>
    list.filter((other) => other.id !== page.id && other.trashedAt === page.trashedAt && isWithin(list, other.id, page.id));
  const pages = trashed?.filter((page) => !trashed.some((other) => other.id === page.parentId && other.trashedAt === page.trashedAt)) ?? null;

  const restore = async (page: FileMeta) => {
    try {
      await api.restore(page.id);
      onRestored(page);
      await load();
    } catch (error) {
      toast.error(error);
    }
  };

  const remove = async (page: FileMeta) => {
    try {
      await api.deleteForever(page.id);
      toast.show(`Deleted “${page.title}” forever`);
      await load();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <Dialog title="Recently deleted pages" onClose={onClose} wide>
      {!pages ? (
        <Spinner label="Loading deleted pages" />
      ) : pages.length === 0 ? (
        <EmptyState icon={<Trash2 size={32} />} title="Nothing here">
          Pages you move to the trash are kept here until they are deleted forever.
        </EmptyState>
      ) : (
        <ul className="trashed-pages">
          {pages.map((page) => (
            <li key={page.id} className="trashed-page">
              <span className="page-icon">
                <FileTypeIcon type="page" icon={page.icon} size={16} />
              </span>
              <span className="trashed-page-title">
                <strong>{page.title || 'Untitled page'}</strong>
                <small className="muted">
                  {page.trashedAt ? `Deleted ${formatTime(page.trashedAt)}` : ''}
                  {trashed && trashedWith(page, trashed).length > 0 &&
                    ` · with ${trashedWith(page, trashed).length} ${trashedWith(page, trashed).length === 1 ? 'subpage' : 'subpages'}`}
                </small>
              </span>
              {canRestore && (
                <button type="button" className="btn btn-sm" onClick={() => void restore(page)}>
                  <RotateCcw size={14} /> Restore
                </button>
              )}
              {workspace.role === 'owner' &&
                (confirming === page.id ? (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(page)} autoFocus>
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => setConfirming(page.id)}>
                    <Trash2 size={14} /> Delete forever
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
