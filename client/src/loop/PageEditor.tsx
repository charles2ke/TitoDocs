import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import {
  Ban,
  Download,
  Ellipsis,
  FilePlus,
  GripVertical,
  History,
  Keyboard,
  Link2,
  MessageSquareText,
  Plus,
  Printer,
  Replace,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { canComment, canEdit, RICH_FIELD, THREADS_FIELD, type ComponentType, type FileMeta } from '@shared/types';
import { api } from '../api';
import { useUser } from '../auth';
import { toAwarenessUser, useRoomStatus, whenSynced, type Room } from '../collab';
import { PromptDialog } from '../components/Dialog';
import { Dropdown, separator, type MenuEntry } from '../components/Menu';
import { ShortcutsDialog, type ShortcutGroup } from '../components/ShortcutsDialog';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/ui';
import { VersionHistory } from '../components/VersionHistory';
import { CommentsPanel, useOpenCommentCount } from '../docs/CommentsPanel';
import { DOC_SHORTCUTS } from '../docs/dialogs';
import { DEFAULT_PAGE_SETUP } from '../docs/pageSetup';
import { anchorRange, getPendingComment, type CommentAuthor, type ThreadsMap } from '../editor/comments';
import { applyInitialContent, clearFormatting, richContent } from '../editor/commands';
import { LinkBubble, TableBubble, TextBubble } from '../editor/EditorBubbles';
import { buildExtensions, contentExtensions, pickImage } from '../editor/extensions';
import { FindReplaceBar } from '../editor/FindReplaceBar';
import { LinkDialog, selectLink } from '../editor/LinkDialog';
import { basicSlashItems } from '../editor/slashItems';
import type { SlashItem } from '../editor/suggestions';
import { takeInitialContent } from '../lib/templates';
import { useLiveFile, type FileState } from '../lib/useFile';
import { absoluteUrl, downloadBlob, escapeHtml, fileUrl, formatTime, isMac, keyName, safeFileName, shortcut } from '../lib/util';
import { TrashedBanner } from '../pages/FileGate';
import { COMPONENT_ORDER, COMPONENT_TYPES } from './componentTypes';
import { clearFresh, isFresh, LoopContext, markFresh, type LoopEnv } from './context';
import { EmojiPicker } from './EmojiPicker';
import { componentLink, LoopComponent } from './LoopComponentNode';
import { ancestors } from './tree';

const DEFAULT_TITLE = 'Untitled page';

export const PAGE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Common actions',
    items: [
      ['Undo', 'Mod-z'],
      ['Redo', 'Mod-Shift-z'],
      ['Find', 'Mod-f'],
      ['Find and replace', 'Mod-h'],
      ['Print', 'Mod-p'],
      ['Insert link', 'Mod-k'],
      ['Insert comment', 'Mod-Alt-m'],
      ['Keyboard shortcuts', 'Mod-/'],
      ['Version history', 'Mod-Alt-Shift-h'],
      ['Insert a Loop component or block (type at the start of a line)', '/'],
      ['Mention a person', '@'],
    ],
  },
  // Font sizes are a document feature; the other formatting keys work the same in pages.
  ...DOC_SHORTCUTS.slice(1).map((group) => ({ ...group, items: group.items.filter(([label]) => !label.includes('font size')) })),
];

// ------------------------------------------------------------------ positions

type TrackedPosition = (state: EditorState) => number | null;

/**
 * Follows a position through everyone's edits while something is created on the server. Remote changes replace the
 * whole ProseMirror document, so the position is tied to the shared Yjs document instead.
 */
function trackPosition(state: EditorState, pos: number): TrackedPosition {
  const sync = ySyncPluginKey.getState(state);
  if (!sync?.binding) return () => null;
  let relative: ReturnType<typeof absolutePositionToRelativePosition>;
  try {
    relative = absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping);
  } catch {
    return () => null;
  }
  return (current) => {
    const now = ySyncPluginKey.getState(current);
    if (!now?.binding) return null;
    try {
      const resolved = relativePositionToAbsolutePosition(now.doc, now.type, relative, now.binding.mapping);
      return resolved === null || resolved > current.doc.content.size ? null : resolved;
    } catch {
      return null;
    }
  };
}

/** The selection's position, or the end of a selected block. */
const cursorOf = (state: EditorState): number => (state.selection instanceof NodeSelection ? state.selection.to : state.selection.from);

/** Where a new block goes for a cursor at `pos`: in place of an empty top-level paragraph, otherwise after the top-level block. */
function blockPosition(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  if ($pos.depth === 0) return $pos.pos;
  if ($pos.depth === 1 && $pos.parent.isTextblock && $pos.parent.content.size === 0) return $pos.pos;
  return $pos.after(1);
}

const resolveBlockPosition = (state: EditorState, tracked: TrackedPosition | null): number =>
  blockPosition(state, tracked?.(state) ?? state.doc.content.size);

/** Puts the cursor in an empty paragraph at the end of the page, adding one unless the page already ends with one. */
function continuePage(editor: Editor) {
  const last = editor.state.doc.lastChild;
  if (last?.type.name === 'paragraph' && last.content.size === 0) editor.commands.focus('end');
  else editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run();
}

// ------------------------------------------------------------------ slash menu

const ICON = 18;

interface LoopActions {
  insertComponent: (editor: Editor, type: ComponentType) => void;
  startSubpage: (editor: Editor) => void;
}

function loopSlashItems({ insertComponent, startSubpage }: LoopActions): SlashItem[] {
  const components = COMPONENT_ORDER.map((type): SlashItem => {
    const info = COMPONENT_TYPES[type];
    return {
      id: `loop-${type}`,
      title: info.label,
      description: info.description,
      icon: <info.icon size={ICON} />,
      group: 'Loop components',
      keywords: info.keywords.join(' '),
      run: (editor) => insertComponent(editor, type),
    };
  });
  return [
    ...components,
    {
      id: 'subpage',
      title: 'Subpage',
      description: 'A new page inside this one',
      icon: <FilePlus size={ICON} />,
      group: 'Pages',
      keywords: 'page child nested link',
      run: startSubpage,
    },
  ];
}

// ------------------------------------------------------------------ page editor

type PageDialog = 'link' | 'shortcuts' | 'versions' | 'subpage';
type DownloadFormat = 'md' | 'html' | 'txt' | 'pdf';

/** A page for the PDF download: its title, then its content with links in place of Loop components. */
function pdfContent(title: string, doc: JSONContent): JSONContent {
  const replace = (node: JSONContent): JSONContent => {
    if (node.type === 'loopComponent') {
      const { href, label } = componentLink(node.attrs);
      return { type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] }] };
    }
    return node.content ? { ...node, content: node.content.map(replace) } : node;
  };
  const heading: JSONContent[] = title ? [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }] : [];
  return { ...doc, content: [...heading, ...(doc.content ?? []).map(replace)] };
}

export interface PageEditorProps {
  state: FileState;
  file: FileMeta;
  workspace: FileMeta;
  pages: FileMeta[];
  room: Room;
  commentsRoom: Room;
  sidebarToggle: ReactNode;
  onPatched: (id: string, patch: Partial<Pick<FileMeta, 'title' | 'icon'>>) => void;
  onAddSubpage: (parentId: string, title: string) => Promise<FileMeta>;
  onCopyLink: (page: FileMeta) => void;
  onTrash: (page: FileMeta) => void;
}

/** A Loop page: a shared rich-text canvas that can hold live components. */
export function PageEditor({ state, file, workspace, pages, room, commentsRoom, sidebarToggle, onPatched, onAddSubpage, onCopyLink, onTrash }: PageEditorProps) {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  useLiveFile(state, room);
  const status = useRoomStatus(room);

  const canEditPage = canEdit(file.role) && !file.trashedAt && !status.denied;
  const canCommentPage = canComment(file.role) && !file.trashedAt && !status.denied;

  const threads = useMemo<ThreadsMap>(() => commentsRoom.doc.getMap<Y.Map<unknown>>(THREADS_FIELD), [commentsRoom]);
  const author = useMemo<CommentAuthor>(() => ({ id: user.id, name: user.displayName, color: user.color }), [user]);
  const openComments = useOpenCommentCount(threads);

  const [loaded, setLoaded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [bubbleHost, setBubbleHost] = useState<HTMLDivElement | null>(null);
  const [freshTitle] = useState(() => isFresh(file.id));
  const subpageAt = useRef<TrackedPosition | null>(null);

  // The comments plugin keeps the callback it was created with, so the editor is read from a ref.
  const editorRef = useRef<Editor | null>(null);
  const activateComment = useCallback((threadId: string) => {
    setShowComments(true);
    editorRef.current?.commands.setActiveComment(threadId);
  }, []);

  const insertComponent = useCallback(
    async (target: Editor, type: ComponentType) => {
      const at = trackPosition(target.state, cursorOf(target.state));
      try {
        const { file: component } = await api.createFile({ type: 'component', componentType: type, title: COMPONENT_TYPES[type].label });
        if (target.isDestroyed || !target.isEditable) return;
        markFresh(component.id);
        target.chain().insertLoopComponent({ id: component.id, type }, resolveBlockPosition(target.state, at)).run();
      } catch (error) {
        toast.error(error);
      }
    },
    [toast],
  );
  const startSubpage = useCallback((target: Editor) => {
    subpageAt.current = trackPosition(target.state, cursorOf(target.state));
    setDialog('subpage');
  }, []);

  const [awarenessUser] = useState(() => toAwarenessUser(user));
  const extensions = useMemo(
    () =>
      buildExtensions({
        room,
        user: awarenessUser,
        placeholder: 'Type “/” to add a Loop component, list, table and more',
        threads,
        onActivateComment: activateComment,
        slashItems: () => [
          ...loopSlashItems({ insertComponent: (target, type) => void insertComponent(target, type), startSubpage }),
          ...basicSlashItems({ onImage: (target) => void pickImage(target, toast.error) }),
        ],
        onError: toast.error,
        extra: [LoopComponent],
      }),
    [room, awarenessUser, threads, activateComment, insertComponent, startSubpage, toast],
  );
  const editor = useEditor(
    {
      extensions,
      editable: false,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { 'aria-label': 'Page content' } },
    },
    [extensions],
  );
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const editable = loaded && canEditPage;
  useEffect(() => {
    if (!editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  // Wait for the server's copy before editing; a new page's starter content is added then.
  useEffect(() => {
    let cancelled = false;
    void whenSynced(room).then(() => {
      if (cancelled || editor.isDestroyed) return;
      const initial = canEdit(file.role) && !file.trashedAt ? takeInitialContent(file.id) : null;
      if (initial?.kind === 'html' && room.doc.getXmlFragment(RICH_FIELD).length === 0) applyInitialContent(editor, initial.html);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [room, editor, file.id, file.role, file.trashedAt]);

  useEffect(() => {
    if (!status.unsynced) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status.unsynced]);

  // Show the comments when the page has some (once: closing the panel keeps it closed).
  const commentsShown = useRef(false);
  useEffect(() => {
    if (openComments > 0 && !commentsShown.current) {
      commentsShown.current = true;
      setShowComments(true);
    }
  }, [openComments]);

  const loop = useMemo<LoopEnv>(() => ({ pageEditable: editable, scrollEl }), [editable, scrollEl]);
  const trail = useMemo(() => ancestors(pages, file.id), [pages, file.id]);

  // ---------------------------------------------------------------- actions

  const closeDialog = () => {
    setDialog(null);
    subpageAt.current = null;
    // The dialog has to be gone before the editor can take the focus back.
    requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.isEditable) editor.commands.focus();
    });
  };

  const openLink = () => {
    if (!editor.isEditable) return;
    selectLink(editor);
    setDialog('link');
  };

  const openVersions = () => canEditPage && setDialog('versions');

  const openFind = (replace: boolean) => setFind((current) => ({ replace, key: (current?.key ?? 0) + 1 }));

  const closeComments = () => {
    setShowComments(false);
    if (getPendingComment(editor.state)) editor.commands.setPendingComment(null);
  };
  const toggleComments = () => (showComments ? closeComments() : setShowComments(true));

  const addComment = () => {
    if (!canCommentPage) return;
    const { from, to } = editor.state.selection;
    const range = editor.state.doc.textBetween(from, to, ' ', ' ').trim() ? anchorRange(editor.state, { from, to }) : null;
    if (!range) {
      toast.show('Select some text to comment on.');
      return;
    }
    editor.chain().setActiveComment(null).setPendingComment(range).run();
    setShowComments(true);
  };

  const print = () => window.print();

  const download = async (format: DownloadFormat) => {
    try {
      if (format === 'pdf') {
        const { exportPdf } = await import('../docs/pdf');
        const { blob, warning } = await exportPdf(pdfContent(file.title, editor.getJSON()), file.title, DEFAULT_PAGE_SETUP);
        downloadBlob(blob, `${safeFileName(file.title)}.pdf`);
        if (warning) toast.show(warning, { action: { label: 'Print', onClick: print } });
        return;
      }
      const exporters = await import('../docs/exporters');
      const html = `<h1>${escapeHtml(file.title)}</h1>${editor.getHTML()}`;
      let blob: Blob;
      if (format === 'html') blob = await exporters.exportHtml(html, file.title, { ...DEFAULT_PAGE_SETUP, pageless: true });
      else if (format === 'md') blob = new Blob([exporters.exportMarkdown(html)], { type: 'text/markdown;charset=utf-8' });
      else blob = new Blob([`${file.title}\n\n${exporters.exportText(editor.state.doc)}`], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `${safeFileName(file.title)}.${format}`);
    } catch (error) {
      toast.error(error);
    }
  };

  const rename = async (title: string) => {
    const shown = title || DEFAULT_TITLE;
    state.setFile((current) => ({ ...current, title: shown }));
    onPatched(file.id, { title: shown });
    try {
      await api.updateFile(file.id, { title });
    } catch (error) {
      toast.error(error);
      void state.reload();
    }
  };

  const setIcon = async (icon: string | null) => {
    state.setFile((current) => ({ ...current, icon }));
    onPatched(file.id, { icon });
    try {
      await api.updateFile(file.id, { icon });
    } catch (error) {
      toast.error(error);
      void state.reload();
    }
  };

  const createSubpage = async (value: string) => {
    const page = await onAddSubpage(file.id, value.trim());
    const at = subpageAt.current;
    if (!editor.isDestroyed && editor.isEditable) {
      const text = `${page.icon ? `${page.icon} ` : ''}${page.title}`;
      editor
        .chain()
        .insertContentAt(resolveBlockPosition(editor.state, at), {
          type: 'paragraph',
          content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: absoluteUrl(fileUrl(page)) } }] }],
        })
        .run();
    }
    toast.show(`Added the subpage “${page.title}”`, { kind: 'success', action: { label: 'Open', onClick: () => navigate(fileUrl(page)) } });
  };

  const restoreVersion = (doc: Y.Doc) => {
    const content = richContent(doc);
    if (content) editor.commands.setContent(content);
    else editor.commands.clearContent();
  };

  // Shortcuts that work anywhere on the page (the editor handles text formatting itself).
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !(isMac ? event.metaKey : event.ctrlKey)) return;
    if (event.getModifierState('AltGraph') || dialog === 'versions' || document.querySelector('dialog[open]')) return;
    const key = keyName(event);
    const { shiftKey: shift, altKey: alt } = event;
    const target = event.target instanceof Element ? event.target : null;
    const inField = !!target?.closest('input, textarea, select');
    // Components handle their own keys; the page's text commands would act on the page around them.
    const inComponent = !!target?.closest('.loop-node');
    const editing = !inField && !inComponent && editor.isEditable;
    let action: (() => unknown) | null = null;
    if (!shift && !alt) {
      if (key === 'p') action = print;
      else if (key === 's') action = () => toast.show('TitoDocs saves your changes automatically.');
      else if (key === 'f') action = () => openFind(false);
      else if (key === 'h') action = () => openFind(true);
      else if (key === 'Slash') action = () => setDialog('shortcuts');
      else if (key === 'k' && editing) action = openLink;
      else if (key === 'Backslash' && editing) action = () => clearFormatting(editor);
    } else if (alt && !shift) {
      if (key === 'm' && !inField && !inComponent && canCommentPage) action = addComment;
    } else if (alt && shift) {
      if (key === 'h' && canEditPage) action = openVersions;
    }
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const insertItems = (): MenuEntry[] => [
    { type: 'label', label: 'Loop components' },
    ...COMPONENT_ORDER.map((type): MenuEntry => {
      const info = COMPONENT_TYPES[type];
      return { label: info.label, icon: <info.icon size={16} />, onSelect: () => void insertComponent(editor, type), testId: `insert-${type}` };
    }),
    separator,
    { label: 'Subpage', icon: <FilePlus size={16} />, onSelect: () => startSubpage(editor), testId: 'insert-subpage' },
  ];

  const moreItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [{ label: 'Find and replace', icon: <Replace size={16} />, shortcut: shortcut('Mod-h'), onSelect: () => openFind(true) }];
    if (canEditPage) {
      items.push({ label: 'Version history', icon: <History size={16} />, shortcut: shortcut('Mod-Alt-Shift-h'), onSelect: openVersions, testId: 'menu-versions' });
    }
    items.push(
      {
        label: 'Download',
        icon: <Download size={16} />,
        submenu: [
          { label: 'PDF document (.pdf)', onSelect: () => void download('pdf') },
          { label: 'Markdown (.md)', onSelect: () => void download('md') },
          { label: 'Web page (.html)', onSelect: () => void download('html') },
          { label: 'Plain text (.txt)', onSelect: () => void download('txt') },
        ],
      },
      { label: 'Print', icon: <Printer size={16} />, shortcut: shortcut('Mod-p'), onSelect: print },
      separator,
      { label: 'Copy page link', icon: <Link2 size={16} />, onSelect: () => onCopyLink(file) },
      { label: 'Keyboard shortcuts', icon: <Keyboard size={16} />, shortcut: shortcut('Mod-/'), onSelect: () => setDialog('shortcuts') },
    );
    if (canEditPage) {
      items.push(separator, { label: 'Move to trash', icon: <Trash2 size={16} />, danger: true, onSelect: () => onTrash(file), testId: 'menu-trash-page' });
    }
    return items;
  };

  return (
    <>
      <div className="page-toolbar no-print">
        {sidebarToggle}
        <nav className="page-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to={fileUrl(workspace)}>{workspace.title}</Link>
            </li>
            {trail.map((page) => (
              <li key={page.id}>
                <Link to={fileUrl(page)}>{page.title}</Link>
              </li>
            ))}
            <li aria-current="page">{file.title}</li>
          </ol>
        </nav>
        <span className="spacer" />
        {canEditPage && (
          <Dropdown
            align="end"
            label="Insert"
            items={insertItems}
            trigger={(props) => (
              <button type="button" className="btn btn-sm" disabled={!editable} data-testid="insert-menu" {...props}>
                <Plus size={16} /> Insert
              </button>
            )}
          />
        )}
        <button
          type="button"
          className="icon-btn comments-toggle"
          aria-label={openComments ? `Comments (${openComments} open)` : 'Comments'}
          aria-pressed={showComments}
          title="Comments"
          onClick={toggleComments}
          data-testid="comments-toggle"
        >
          <MessageSquareText size={20} />
          {openComments > 0 && (
            <span className="comments-badge" aria-hidden="true">
              {openComments > 99 ? '99+' : openComments}
            </span>
          )}
        </button>
        <Dropdown
          align="end"
          label="Page options"
          items={moreItems}
          trigger={(props) => (
            <button type="button" className="icon-btn" aria-label="Page options" title="More options" data-testid="page-options" {...props}>
              <Ellipsis size={20} />
            </button>
          )}
        />
      </div>
      <TrashedBanner file={file} onRestored={() => void state.reload()} />
      {status.denied && (
        <div className="banner banner-warning" role="alert">
          <Ban size={16} />
          <span>You no longer have access to this page.</span>
        </div>
      )}
      <div className="page-body">
        <div className="page-content">
          {find && (
            <FindReplaceBar
              editor={editor}
              showReplace={find.replace}
              onToggleReplace={() => setFind((current) => current && { ...current, replace: !current.replace })}
              onClose={() => setFind(null)}
              focusKey={find.key}
            />
          )}
          <div className="page-scroll" ref={setScrollEl}>
            <article className="page-paper" data-testid="page-paper">
              <header className="page-head">
                {canEditPage ? (
                  <EmojiPicker value={file.icon} onChange={(icon) => void setIcon(icon)} className="page-head-picker no-print">
                    {(props) =>
                      file.icon ? (
                        <button type="button" className="page-head-icon" aria-label="Change page icon" title="Change icon" {...props}>
                          {file.icon}
                        </button>
                      ) : (
                        <button type="button" className="btn btn-sm page-add-icon" {...props}>
                          <SmilePlus size={16} /> Add icon
                        </button>
                      )
                    }
                  </EmojiPicker>
                ) : (
                  file.icon && (
                    <span className="page-head-icon" aria-hidden="true">
                      {file.icon}
                    </span>
                  )
                )}
                <PageTitle
                  key={file.id}
                  title={file.title}
                  editable={canEditPage}
                  autoFocus={freshTitle}
                  onRename={(title) => void rename(title)}
                  onFocused={() => clearFresh(file.id)}
                  onEnter={() => editor.isEditable && editor.commands.focus('start')}
                />
                <p className="page-byline">
                  Created by {file.ownerName} · {formatTime(file.createdAt)}
                </p>
              </header>
              <LoopContext value={loop}>
                <EditorContent editor={editor} className="page-editor" />
              </LoopContext>
              {!loaded && !status.denied && (
                <div className="page-loading">
                  <Spinner label="Loading page" />
                </div>
              )}
              {/* Clicking below the text continues it, as on a sheet of paper. */}
              <div
                className="page-end no-print"
                aria-hidden="true"
                onMouseDown={(event) => {
                  if (event.button !== 0 || !editor.isEditable) return;
                  event.preventDefault();
                  continuePage(editor);
                }}
              />
            </article>
          </div>
          <div className="bubble-host" ref={setBubbleHost} />
        </div>
        {showComments && (
          <CommentsPanel
            editor={editor}
            threads={threads}
            user={author}
            canComment={canCommentPage}
            canModerate={canEdit(file.role)}
            onClose={closeComments}
          />
        )}
      </div>

      {editable && (
        <DragHandle editor={editor} className="drag-handle" nested>
          <GripVertical size={16} aria-hidden />
        </DragHandle>
      )}
      {bubbleHost && scrollEl && (
        <>
          <TextBubble editor={editor} container={bubbleHost} scrollTarget={scrollEl} canComment={canCommentPage} onComment={addComment} onLink={openLink} />
          <LinkBubble editor={editor} container={bubbleHost} scrollTarget={scrollEl} onEdit={openLink} />
          <TableBubble editor={editor} container={bubbleHost} scrollTarget={scrollEl} />
        </>
      )}

      {dialog === 'link' && <LinkDialog editor={editor} onClose={closeDialog} />}
      {dialog === 'shortcuts' && <ShortcutsDialog groups={PAGE_SHORTCUTS} onClose={closeDialog} />}
      {dialog === 'subpage' && (
        <PromptDialog
          title="New subpage"
          label="Page name"
          placeholder={DEFAULT_TITLE}
          confirmLabel="Create"
          onSubmit={createSubpage}
          onClose={closeDialog}
        />
      )}
      {dialog === 'versions' && (
        <VersionHistory file={file} renderPreview={(doc) => <PagePreview doc={doc} />} onRestore={restoreVersion} onClose={closeDialog} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ title

interface PageTitleProps {
  title: string;
  editable: boolean;
  /** Focus and select the title (for pages created a moment ago). */
  autoFocus: boolean;
  onRename: (title: string) => void;
  onFocused: () => void;
  /** Enter moves on to the page's text. */
  onEnter: () => void;
}

const RENAME_DELAY = 800;
const cleanTitle = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The page's name, edited in place above its content. Renames are saved while typing. */
function PageTitle({ title, editable, autoFocus, onRename, onFocused, onEnter }: PageTitleProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The text being edited, while the field has the focus; otherwise the saved title is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const original = useRef(title);
  const saved = useRef(title);
  const reverting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const value = draft ?? title;

  const commit = (next: string) => {
    clearTimeout(timer.current);
    const cleaned = cleanTitle(next);
    if (cleaned === saved.current) return;
    saved.current = cleaned;
    onRename(cleaned);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [value, editable]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!autoFocus || !editable || focusedOnce.current) return;
    focusedOnce.current = true;
    ref.current?.focus();
    ref.current?.select();
    onFocused();
  }, [autoFocus, editable, onFocused]);

  if (!editable) return <h1 className="page-title">{title}</h1>;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.currentTarget.value);
      onEnter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(original.current);
      reverting.current = true;
      event.currentTarget.blur();
    }
  };

  return (
    <h1 className="page-title">
      <textarea
        ref={ref}
        className="page-title-input"
        aria-label="Page title"
        placeholder={DEFAULT_TITLE}
        rows={1}
        maxLength={200}
        spellCheck
        value={value}
        onFocus={() => {
          original.current = title;
          saved.current = title;
          setDraft(title);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[\r\n]+/g, ' ');
          setDraft(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(next), RENAME_DELAY);
        }}
        onBlur={(event) => {
          if (!reverting.current) commit(event.currentTarget.value);
          reverting.current = false;
          setDraft(null);
        }}
        onKeyDown={onKeyDown}
      />
    </h1>
  );
}

// ------------------------------------------------------------------ versions

/** A saved version of a page. Loop components are shown as links: their content is not part of the page's versions. */
function PagePreview({ doc }: { doc: Y.Doc }) {
  const content = useMemo(() => richContent(doc), [doc]);
  const extensions = useMemo(() => contentExtensions([LoopComponent.configure({ preview: true })]), []);
  const editor = useEditor(
    { extensions, content, editable: false, shouldRerenderOnTransaction: false, editorProps: { attributes: { 'aria-label': 'Version content' } } },
    [content],
  );
  return (
    <div className="page-paper page-preview" data-testid="version-paper">
      <EditorContent editor={editor} className="page-editor" />
    </div>
  );
}
