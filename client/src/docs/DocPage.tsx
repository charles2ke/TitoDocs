import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { Ban, Eye, MessageSquare, MessageSquareText } from 'lucide-react';
import { canComment, canEdit, commentsDocName, META_FIELD, RICH_FIELD, THREADS_FIELD, type FileMeta } from '@shared/types';
import { api, errorMessage } from '../api';
import { useUser } from '../auth';
import { toAwarenessUser, usePresence, useRoom, useRoomStatus, whenSynced, type Room } from '../collab';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog, PromptDialog } from '../components/Dialog';
import { MenuBar } from '../components/Menu';
import { useToast } from '../components/Toast';
import { FileTypeIcon, FullPageSpinner, Spinner } from '../components/ui';
import { VersionHistory } from '../components/VersionHistory';
import { anchorRange, getPendingComment, type CommentAuthor, type ThreadsMap } from '../editor/comments';
import { applyInitialContent, applyMarks, captureMarks, clearFormatting } from '../editor/commands';
import { LinkBubble, TableBubble, TextBubble } from '../editor/EditorBubbles';
import { buildExtensions, contentExtensions, IMAGE_TYPES, insertImages } from '../editor/extensions';
import { FindReplaceBar } from '../editor/FindReplaceBar';
import { LinkDialog, selectLink } from '../editor/LinkDialog';
import { basicSlashItems } from '../editor/slashItems';
import { DOC_IMPORT_ACCEPT, stripExtension } from '../lib/files';
import { setInitialContent, takeInitialContent } from '../lib/templates';
import { useFile, useLiveFile, type FileState } from '../lib/useFile';
import { downloadBlob, fileUrl, isMac, pickFile, safeFileName, useLocalStorage } from '../lib/util';
import { FileGate, TrashedBanner } from '../pages/FileGate';
import { CommentsPanel, useOpenCommentCount } from './CommentsPanel';
import { PageSetupDialog, ShortcutsDialog, SpecialCharactersDialog, useTextStats, WordCountDialog } from './dialogs';
import { buildDocMenus, type DocDialog, type DownloadFormat } from './docMenus';
import { stepSelectionFontSize, ZOOM_LEVELS, type DocMode } from './formatting';
import { OutlinePanel } from './OutlinePanel';
import { paperSize, printCss, readPageSetup, usePageSetup, writePageSetup, type PageSetup } from './pageSetup';
import { Toolbar } from './Toolbar';
import '../editor/editor.css';
import './docs.css';

type ActiveDialog = DocDialog | 'copy';

const textToDoc = (text: string): JSONContent => ({
  type: 'doc',
  content: text.split(/\r?\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
});

/** The rich-text content of a Yjs document, or null when it is empty. */
function richContent(doc: Y.Doc): JSONContent | null {
  const json = yDocToProsemirrorJSON(doc, RICH_FIELD) as JSONContent;
  return json.content?.length ? json : null;
}

/** Paper size and margins as CSS (pageless documents are styled by the `.pageless` class instead). */
function paperStyle(setup: PageSetup): CSSProperties | undefined {
  if (setup.pageless) return undefined;
  const { width, height } = paperSize(setup);
  const { top, right, bottom, left } = setup.margins;
  return { width: `${width}in`, minHeight: `${height}in`, padding: `${top}in ${right}in ${bottom}in ${left}in` };
}

const isImageUrl = (src: string): boolean => {
  // Same-origin paths (uploaded images) and https addresses: the content security policy blocks plain http.
  if (/^\/(?!\/)/.test(src)) return true;
  try {
    return new URL(src).protocol === 'https:';
  } catch {
    return false;
  }
};

async function pickImage(editor: Editor, onError: (error: unknown) => void): Promise<void> {
  const image = await pickFile(IMAGE_TYPES.join(','));
  if (!image) return;
  if (!IMAGE_TYPES.includes(image.type)) {
    onError(new Error('Choose a PNG, JPEG, GIF or WebP image.'));
    return;
  }
  await insertImages(editor, [image], null, onError);
}

/** The word around the cursor (the format painter formats the clicked word when nothing is selected). */
function wordAt(editor: Editor): { from: number; to: number } | null {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '\ufffc');
  const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_'’-]/u.test(char);
  let start = $from.parentOffset;
  let end = start;
  while (isWordChar(text[start - 1])) start -= 1;
  while (isWordChar(text[end])) end += 1;
  return start === end ? null : { from: $from.start() + start, to: $from.start() + end };
}

/** The key of a shortcut, independent of the characters that Shift and Alt produce on the keyboard layout. */
function keyName(event: KeyboardEvent): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  return event.code;
}

export default function DocPage() {
  const { id = '' } = useParams();
  const state = useFile(id);
  return (
    <FileGate state={state} expect={['doc']}>
      {(file) => <DocRooms key={file.id} state={state} file={file} />}
    </FileGate>
  );
}

/** Joins the document's collaboration room and its comments room (commenters may write comments, not text). */
function DocRooms({ state, file }: { state: FileState; file: FileMeta }) {
  const room = useRoom(file.id);
  const commentsRoom = useRoom(commentsDocName(file.id));
  if (!room || !commentsRoom) return <FullPageSpinner />;
  return <DocEditor state={state} file={file} room={room} commentsRoom={commentsRoom} />;
}

interface DocEditorProps {
  state: FileState;
  file: FileMeta;
  room: Room;
  commentsRoom: Room;
}

function DocEditor({ state, file, room, commentsRoom }: DocEditorProps) {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  useLiveFile(state, room);
  const status = useRoomStatus(room);
  const people = usePresence(room);

  const canEditFile = canEdit(file.role) && !file.trashedAt && !status.denied;
  const canCommentFile = canComment(file.role) && !file.trashedAt && !status.denied;
  const isOwner = file.role === 'owner';

  const threads = useMemo<ThreadsMap>(() => commentsRoom.doc.getMap<Y.Map<unknown>>(THREADS_FIELD), [commentsRoom]);
  const meta = useMemo(() => room.doc.getMap<unknown>(META_FIELD), [room]);
  const setup = usePageSetup(meta);
  const author = useMemo<CommentAuthor>(() => ({ id: user.id, name: user.displayName, color: user.color }), [user]);
  const openComments = useOpenCommentCount(threads);

  const [mode, setMode] = useState<DocMode>('editing');
  const [loaded, setLoaded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [painter, setPainter] = useState<readonly Mark[] | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [bubbleHost, setBubbleHost] = useState<HTMLDivElement | null>(null);
  const [storedZoom, setZoom] = useLocalStorage('doc-zoom', 100);
  const [showOutline, setShowOutline] = useLocalStorage('doc-outline', true);
  const [showWordCount, setShowWordCount] = useLocalStorage('doc-word-count', false);
  const [spellcheck, setSpellcheck] = useLocalStorage('doc-spellcheck', true);
  const zoom = ZOOM_LEVELS.includes(storedZoom) ? storedZoom : 100;

  // The comments plugin keeps the callback it was created with, so the editor is read from a ref.
  const editorRef = useRef<Editor | null>(null);
  const activateComment = useCallback((threadId: string) => {
    setShowComments(true);
    editorRef.current?.commands.setActiveComment(threadId);
  }, []);
  const [awarenessUser] = useState(() => toAwarenessUser(user));
  const extensions = useMemo(
    () =>
      buildExtensions({
        room,
        user: awarenessUser,
        placeholder: 'Type “/” for commands',
        threads,
        onActivateComment: activateComment,
        slashItems: () => basicSlashItems({ onImage: (target) => void pickImage(target, toast.error), documentBlocks: true }),
        onError: toast.error,
      }),
    [room, awarenessUser, threads, activateComment, toast],
  );
  const editor = useEditor(
    {
      extensions,
      editable: false,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { spellcheck: String(spellcheck), 'aria-label': 'Document content' } },
    },
    [extensions],
  );
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const editable = loaded && canEditFile && mode === 'editing';
  useEffect(() => {
    if (!editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.setOptions({ editorProps: { attributes: { spellcheck: String(spellcheck), 'aria-label': 'Document content' } } });
  }, [editor, spellcheck]);

  useEffect(() => {
    document.title = `${file.title} - TitoDocs`;
    return () => {
      document.title = 'TitoDocs';
    };
  }, [file.title]);

  // Wait for the server's copy before editing; a new file's template or imported content is added then.
  useEffect(() => {
    let cancelled = false;
    void whenSynced(room).then(() => {
      if (cancelled || editor.isDestroyed) return;
      const initial = canEdit(file.role) && !file.trashedAt ? takeInitialContent(file.id) : null;
      if (initial && room.doc.getXmlFragment(RICH_FIELD).length === 0) {
        applyInitialContent(editor, initial.kind === 'html' ? initial.html : textToDoc(initial.text));
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [room, editor, file.id, file.role, file.trashedAt]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!editable || focusedOnce.current || editor.isDestroyed) return;
    focusedOnce.current = true;
    editor.commands.focus('start', { scrollIntoView: false });
  }, [editor, editable]);

  // Format painter: the next selection made with the mouse (or the clicked word) gets the copied formatting.
  useEffect(() => {
    if (!editable) setPainter(null);
  }, [editable]);
  useEffect(() => {
    if (!painter) return;
    let startedInEditor = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMouseDown = (event: MouseEvent) => {
      startedInEditor = event.button === 0 && editor.view.dom.contains(event.target as Node);
    };
    const onMouseUp = () => {
      if (!startedInEditor) return;
      startedInEditor = false;
      // ProseMirror updates the selection after mouseup.
      timer = setTimeout(() => {
        if (editor.isDestroyed || !editor.isEditable) return;
        const word = wordAt(editor);
        if (word) editor.commands.setTextSelection(word);
        if (applyMarks(editor, painter)) setPainter(null);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPainter(null);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [painter, editor]);

  useEffect(() => {
    if (!status.unsynced) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status.unsynced]);

  // Show the comments when the document has some (once: closing the panel keeps it closed).
  const commentsShown = useRef(false);
  useEffect(() => {
    if (openComments > 0 && !commentsShown.current) {
      commentsShown.current = true;
      setShowComments(true);
    }
  }, [openComments]);

  // ---------------------------------------------------------------- actions

  const notify = (message: string) => toast.show(message);

  const closeDialog = () => {
    setDialog(null);
    // The dialog has to be gone before the editor can take the focus back.
    requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.isEditable) editor.commands.focus();
    });
  };

  const openDialog = (next: DocDialog) => {
    if ((next === 'link' || next === 'imageUrl' || next === 'altText' || next === 'specialCharacters') && !editor.isEditable) return;
    if ((next === 'versions' || next === 'nameVersion' || next === 'pageSetup') && !canEditFile) return;
    if (next === 'trash' && !isOwner) return;
    if (next === 'link') selectLink(editor);
    setDialog(next);
  };

  const openFind = (replace: boolean) => setFind((current) => ({ replace, key: (current?.key ?? 0) + 1 }));

  const closeComments = () => {
    setShowComments(false);
    if (getPendingComment(editor.state)) editor.commands.setPendingComment(null);
  };
  const toggleComments = () => (showComments ? closeComments() : setShowComments(true));

  const addComment = () => {
    if (!canCommentFile) return;
    const { from, to } = editor.state.selection;
    const range = editor.state.doc.textBetween(from, to, ' ', ' ').trim() ? anchorRange(editor.state, { from, to }) : null;
    if (!range) {
      toast.show('Select some text to comment on.');
      return;
    }
    editor.chain().setActiveComment(null).setPendingComment(range).run();
    setShowComments(true);
  };

  const uploadImage = () => void pickImage(editor, toast.error);

  const print = () => window.print();

  const download = async (format: DownloadFormat) => {
    if (format === 'pdf') {
      toast.show('In the print dialog, choose “Save as PDF” as the destination.');
      setTimeout(print, 300);
      return;
    }
    try {
      let blob: Blob;
      if (format === 'docx') {
        const { exportDocx } = await import('./docx');
        blob = await exportDocx(editor.getJSON(), file.title, setup);
      } else {
        const exporters = await import('./exporters');
        if (format === 'html') blob = await exporters.exportHtml(editor.getHTML(), file.title, setup);
        else if (format === 'md') blob = new Blob([exporters.exportMarkdown(editor.getHTML())], { type: 'text/markdown;charset=utf-8' });
        else blob = new Blob([exporters.exportText(editor.state.doc)], { type: 'text/plain;charset=utf-8' });
      }
      downloadBlob(blob, `${safeFileName(file.title)}.${format}`);
    } catch (error) {
      toast.error(error);
    }
  };

  const newDocument = async () => {
    try {
      const { file: created } = await api.createFile({ type: 'doc' });
      navigate(fileUrl(created));
    } catch (error) {
      toast.error(error);
    }
  };

  const openFile = async () => {
    const picked = await pickFile(DOC_IMPORT_ACCEPT);
    if (!picked) return;
    try {
      const { fileToHtml } = await import('./importers');
      const html = await fileToHtml(picked);
      const { file: created } = await api.createFile({ type: 'doc', title: stripExtension(picked.name) });
      setInitialContent(created.id, { kind: 'html', html });
      navigate(fileUrl(created));
    } catch (error) {
      toast.show(`Could not open ${picked.name}: ${errorMessage(error)}`, { kind: 'error' });
    }
  };

  const rename = () => {
    const input = document.querySelector<HTMLInputElement>('.app-header .title-input');
    input?.focus();
    input?.select();
  };

  const makeCopy = async (title: string) => {
    const { file: copy } = await api.duplicate(file.id, title.trim() || undefined);
    navigate(fileUrl(copy));
  };

  const trash = async () => {
    try {
      await api.trash(file.id);
      navigate('/');
      toast.show(`“${file.title}” was moved to the trash`, {
        action: { label: 'Undo', onClick: () => void api.restore(file.id).then(() => navigate(fileUrl(file)), toast.error) },
      });
    } catch (error) {
      toast.error(error);
    }
  };

  const insertImageUrl = (value: string) => {
    const src = value.trim();
    if (!isImageUrl(src)) throw new Error('Enter an image address that starts with https://');
    editor.chain().setImage({ src, alt: '' }).run();
  };

  const setAltText = (value: string) => {
    editor.chain().updateAttributes('image', { alt: value.trim() }).run();
  };

  const nameVersion = async (value: string) => {
    const name = value.trim();
    if (!name) throw new Error('Enter a name for this version.');
    await api.saveVersion(file.id, name);
    toast.show(`Saved version “${name}”`, { kind: 'success' });
  };

  const restoreVersion = (doc: Y.Doc) => {
    const content = richContent(doc);
    if (content) editor.commands.setContent(content);
    else editor.commands.clearContent();
    writePageSetup(meta, readPageSetup(doc.getMap(META_FIELD)));
  };

  // Clicking the page margins puts the cursor at the nearest text, as in a word processor.
  const onPaperMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !editor.isEditable || editor.view.dom.contains(event.target as Node)) return;
    const rect = editor.view.dom.getBoundingClientRect();
    const left = Math.min(Math.max(event.clientX, rect.left + 1), rect.right - 1);
    const top = Math.min(Math.max(event.clientY, rect.top + 1), rect.bottom - 1);
    const found = editor.view.posAtCoords({ left, top });
    event.preventDefault();
    if (!found) {
      editor.commands.focus('end');
      return;
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(found.pos)));
        return true;
      })
      .run();
  };

  // Shortcuts that work anywhere on the page (the editor handles text formatting itself).
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !(isMac ? event.metaKey : event.ctrlKey)) return;
    if (event.getModifierState('AltGraph') || dialog === 'versions' || document.querySelector('dialog[open]')) return;
    const key = keyName(event);
    const { shiftKey: shift, altKey: alt } = event;
    const inField = event.target instanceof Element && !!event.target.closest('input, textarea, select');
    const editing = !inField && editor.isEditable;
    let action: (() => unknown) | null = null;
    if (!shift && !alt) {
      if (key === 'p') action = print;
      else if (key === 'o') action = openFile;
      else if (key === 's') action = () => notify('TitoDocs saves your changes automatically.');
      else if (key === 'f') action = () => openFind(false);
      else if (key === 'h') action = () => openFind(true);
      else if (key === 'Slash') action = () => openDialog('shortcuts');
      else if (key === 'k' && editing) action = () => openDialog('link');
      else if (key === 'Backslash' && editing) action = () => clearFormatting(editor);
    } else if (shift && !alt) {
      if (key === 'c') action = () => openDialog('wordCount');
      else if (key === 'p' && !inField) action = () => editor.commands.toggleInvisibleCharacters();
      else if (key === 'Period' && editing) action = () => stepSelectionFontSize(editor, 1);
      else if (key === 'Comma' && editing) action = () => stepSelectionFontSize(editor, -1);
    } else if (alt && !shift) {
      if (key === 'm' && !inField && canCommentFile) action = addComment;
    } else if (key === 'h' && canEditFile) {
      action = () => openDialog('versions');
    }
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const menus = buildDocMenus({
    editor,
    canEditFile,
    canComment: canCommentFile,
    isOwner,
    mode,
    setMode,
    zoom,
    setZoom,
    showOutline,
    toggleOutline: () => setShowOutline((value) => !value),
    showComments,
    toggleComments,
    showWordCount,
    toggleWordCount: () => setShowWordCount((value) => !value),
    spellcheck,
    toggleSpellcheck: () => setSpellcheck((value) => !value),
    openDialog,
    openFind,
    addComment,
    uploadImage,
    print,
    download: (format) => void download(format),
    newDocument: () => void newDocument(),
    makeCopy: () => setDialog('copy'),
    openFile: () => void openFile(),
    rename,
    notify,
  });

  return (
    <div className={`doc-page ${painter ? 'painting' : ''}`}>
      <style>{printCss(setup)}</style>
      <AppHeader
        file={file}
        workspace={state.workspace}
        status={status}
        people={people}
        onFileChange={state.setFile}
        icon={<FileTypeIcon type="doc" size={26} />}
        menubar={<MenuBar menus={menus} label="Document menu" />}
        actions={
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
        }
      />
      <TrashedBanner file={file} onRestored={() => void state.reload()} />
      {status.denied && (
        <div className="banner banner-warning" role="alert">
          <Ban size={16} />
          <span>You no longer have access to this document.</span>
        </div>
      )}
      {!canEdit(file.role) && !file.trashedAt && !status.denied && (
        <div className="banner banner-info no-print" data-testid="access-banner">
          {canCommentFile ? <MessageSquare size={16} /> : <Eye size={16} />}
          <span>{canCommentFile ? 'You can view and comment on this document, but not edit it.' : 'You can view this document, but not edit it or comment.'}</span>
        </div>
      )}
      <Toolbar
        editor={editor}
        canEditFile={canEditFile}
        canComment={canCommentFile}
        mode={mode}
        onModeChange={setMode}
        zoom={zoom}
        onZoomChange={setZoom}
        painterActive={!!painter}
        onPainter={() => setPainter(painter ? null : captureMarks(editor))}
        onPrint={print}
        onLink={() => openDialog('link')}
        onComment={addComment}
        onUploadImage={uploadImage}
        onImageUrl={() => openDialog('imageUrl')}
      />
      <div className="doc-body">
        {showOutline && <OutlinePanel editor={editor} onClose={() => setShowOutline(false)} />}
        <div className="doc-main">
          {find && (
            <FindReplaceBar
              editor={editor}
              showReplace={find.replace}
              onToggleReplace={() => setFind((current) => current && { ...current, replace: !current.replace })}
              onClose={() => setFind(null)}
              focusKey={find.key}
            />
          )}
          <div className="doc-scroll" ref={setScrollEl}>
            <div className={`doc-zoom ${setup.pageless ? 'pageless' : ''}`} style={{ zoom: zoom / 100 }}>
              <div
                className={`doc-paper ${setup.pageless ? 'pageless' : ''}`}
                style={paperStyle(setup)}
                onMouseDown={onPaperMouseDown}
                data-testid="doc-paper"
              >
                <EditorContent editor={editor} className="doc-editor" />
                {!loaded && !status.denied && (
                  <div className="doc-loading">
                    <Spinner label="Loading document" />
                  </div>
                )}
              </div>
            </div>
          </div>
          {showWordCount && <WordCountBadge editor={editor} onOpen={() => openDialog('wordCount')} />}
          <div className="bubble-host" ref={setBubbleHost} />
        </div>
        {showComments && (
          <CommentsPanel
            editor={editor}
            threads={threads}
            user={author}
            canComment={canCommentFile}
            canModerate={canEdit(file.role)}
            onClose={closeComments}
          />
        )}
      </div>

      {bubbleHost && scrollEl && (
        <>
          <TextBubble
            editor={editor}
            container={bubbleHost}
            scrollTarget={scrollEl}
            canComment={canCommentFile}
            onComment={addComment}
            onLink={() => openDialog('link')}
          />
          <LinkBubble editor={editor} container={bubbleHost} scrollTarget={scrollEl} onEdit={() => openDialog('link')} />
          <TableBubble editor={editor} container={bubbleHost} scrollTarget={scrollEl} />
        </>
      )}

      {dialog === 'link' && <LinkDialog editor={editor} onClose={closeDialog} />}
      {dialog === 'pageSetup' && <PageSetupDialog setup={setup} onApply={(next) => writePageSetup(meta, next)} onClose={closeDialog} />}
      {dialog === 'wordCount' && (
        <WordCountDialog editor={editor} showWhileTyping={showWordCount} onShowWhileTyping={setShowWordCount} onClose={closeDialog} />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={closeDialog} />}
      {dialog === 'specialCharacters' && (
        <SpecialCharactersDialog onInsert={(character) => editor.commands.insertContent({ type: 'text', text: character })} onClose={closeDialog} />
      )}
      {dialog === 'imageUrl' && (
        <PromptDialog
          title="Insert image by URL"
          label="Image address"
          placeholder="https://example.com/picture.png"
          confirmLabel="Insert"
          onSubmit={insertImageUrl}
          onClose={closeDialog}
        />
      )}
      {dialog === 'altText' && (
        <PromptDialog
          title="Alt text"
          label="Describe the image for people who can't see it"
          initial={String(editor.getAttributes('image').alt ?? '')}
          confirmLabel="Save"
          onSubmit={setAltText}
          onClose={closeDialog}
        />
      )}
      {dialog === 'nameVersion' && (
        <PromptDialog title="Name current version" label="Version name" confirmLabel="Save" onSubmit={nameVersion} onClose={closeDialog} />
      )}
      {dialog === 'copy' && (
        <PromptDialog
          title="Make a copy"
          label="Name"
          initial={`Copy of ${file.title}`}
          confirmLabel="Make a copy"
          onSubmit={makeCopy}
          onClose={closeDialog}
        />
      )}
      {dialog === 'trash' && (
        <ConfirmDialog
          title="Move to trash?"
          message={`“${file.title}” will be moved to the trash. You can restore it from the trash on the home page.`}
          confirmLabel="Move to trash"
          danger
          onConfirm={trash}
          onClose={closeDialog}
        />
      )}
      {dialog === 'versions' && (
        <VersionHistory file={file} renderPreview={(doc) => <DocPreview doc={doc} />} onRestore={restoreVersion} onClose={closeDialog} />
      )}
    </div>
  );
}

function WordCountBadge({ editor, onOpen }: { editor: Editor; onOpen: () => void }) {
  const { document: whole, selection } = useTextStats(editor);
  const words = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
  return (
    <button type="button" className="word-count-badge no-print" title="Word count" onClick={onOpen} data-testid="word-count-badge">
      {selection ? `${selection.words.toLocaleString()} of ${words(whole.words)}` : words(whole.words)}
    </button>
  );
}

/** A saved version, shown read-only on the same paper as the document. */
function DocPreview({ doc }: { doc: Y.Doc }) {
  const setup = useMemo(() => readPageSetup(doc.getMap(META_FIELD)), [doc]);
  const content = useMemo(() => richContent(doc), [doc]);
  const extensions = useMemo(() => contentExtensions(), []);
  const editor = useEditor(
    { extensions, content, editable: false, shouldRerenderOnTransaction: false, editorProps: { attributes: { 'aria-label': 'Version content' } } },
    [content],
  );
  return (
    <div className={`doc-zoom ${setup.pageless ? 'pageless' : ''}`}>
      <div className={`doc-paper ${setup.pageless ? 'pageless' : ''}`} style={paperStyle(setup)} data-testid="version-paper">
        <EditorContent editor={editor} className="doc-editor" />
      </div>
    </div>
  );
}
