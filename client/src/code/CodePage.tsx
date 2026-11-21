// The code editor, modelled on Notepad++: CodeMirror bound to the file's shared text, with tabs, menus, a toolbar and a status bar.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { LanguageDescription } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { openSearchPanel, type SearchQuery } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { Ban, Eye } from 'lucide-react';
import { canEdit, CODE_FIELD, META_FIELD, type FileMeta } from '@shared/types';
import { api, errorMessage } from '../api';
import { usePresence, useRoom, useRoomStatus, whenSynced, type Room } from '../collab';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog, PromptDialog } from '../components/Dialog';
import { MenuBar } from '../components/Menu';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { useToast } from '../components/Toast';
import { FileTypeIcon, FullPageSpinner, Spinner } from '../components/ui';
import { VersionHistory } from '../components/VersionHistory';
import { readTextFile } from '../lib/files';
import { setInitialContent, takeInitialContent } from '../lib/templates';
import { useFile, useLiveFile, type FileState } from '../lib/useFile';
import { absoluteUrl, downloadBlob, fileUrl, isMac, keyName, pickFile, safeFileName, useLocalStorage } from '../lib/util';
import { FileGate, TrashedBanner } from '../pages/FileGate';
import { useTheme } from '../theme';
import { buildCodeMenus, CodeToolbar, LOADING_MENUS, type CodeDialog, type CodeMenuContext } from './codeMenus';
import { columnInsert, columnTargets, goToLine, selectionOrDocument } from './commands';
import { CompareView } from './CompareView';
import {
  CODE_SHORTCUTS,
  ColumnEditorDialog,
  CompareDialog,
  GoToLineDialog,
  HashDialog,
  LanguageDialog,
  RunMacroDialog,
  SummaryDialog,
  type CompareSource,
} from './dialogs';
import {
  codeKeymap,
  editorExtensions,
  keyLabel,
  KEYS,
  languageCompartment,
  readCodeSettings,
  readFileSettings,
  reconfigureEditor,
  searchPanel,
  stepZoom,
  useFileSettings,
  viewerExtensions,
  ViewStore,
  writeFileSettings,
  type CodeSettings,
  type EditorConfig,
  type FileSettings,
  type KeyAction,
} from './editorSetup';
import { detectLanguage, PLAIN_TEXT, resolveLanguage } from './languages';
import { describeMacro, isMacroStep, macroRecorder, playMacroRepeatedly, type MacroStep } from './macro';
import { buildPrintout } from './print';
import { ResultsPanel, SearchPanel, type SearchRequest } from './SearchPanel';
import { StatusBar } from './StatusBar';
import { isCodeTab, Tabs, upsertTab, type CodeTab } from './Tabs';
import { applyEol, detectEol, detectIndentation, encodeText, minimalChange, normalizeEol, type HashAlgorithm } from './textOps';
import './code.css';

const readTabs = (stored: unknown): CodeTab[] => (Array.isArray(stored) ? stored.filter(isCodeTab) : []);

/**
 * CodeMirror counts "\r\n" as one line break, so carriage returns in the shared text would put the editor's
 * positions out of step with it. TitoDocs never writes them, but editors remove any they find.
 */
function removeCarriageReturns(ytext: Y.Text): void {
  const text = ytext.toString();
  if (!text.includes('\r') || !ytext.doc) return;
  ytext.doc.transact(() => {
    // Backwards, so the positions still to visit don't move.
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (text[index] !== '\r') continue;
      ytext.delete(index, 1);
      if (text[index + 1] !== '\n') ytext.insert(index, '\n');
    }
  }, 'normalize');
}

/** Read-only editors (which can't remove carriage returns) keep them as characters, so positions still match. */
const separatorCompartment = new Compartment();
const KEEP_CR: Extension = EditorState.lineSeparator.of('\n');
const NONE: Extension = [];

export default function CodePage() {
  const { id = '' } = useParams();
  const state = useFile(id);
  const navigate = useNavigate();
  const [storedTabs, setStoredTabs] = useLocalStorage<unknown>('code-tabs', []);
  const tabs = useMemo(() => readTabs(storedTabs), [storedTabs]);
  const { file } = state;

  useEffect(() => {
    if (!file || file.type !== 'code') return;
    setStoredTabs((stored: unknown) => {
      const current = readTabs(stored);
      const next = upsertTab(current, { id: file.id, title: file.title });
      return next === current ? stored : next;
    });
  }, [file?.id, file?.title, file?.type, setStoredTabs]);

  // Files that no longer exist (or are no longer shared) lose their tab.
  const forgetTab = useEffectEvent(() => setStoredTabs((stored: unknown) => readTabs(stored).filter((tab) => tab.id !== id)));
  useEffect(() => {
    if (state.error?.status === 403 || state.error?.status === 404) forgetTab();
  }, [state.error]);

  const closeTab = (tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    setStoredTabs(remaining);
    if (tabId !== id) return;
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    navigate(next ? `/code/${next.id}` : '/');
  };

  return (
    <FileGate state={state} expect={['code']}>
      {(current) => <CodeRoom key={current.id} state={state} file={current} tabs={tabs} onCloseTab={closeTab} />}
    </FileGate>
  );
}

interface CodeRoomProps {
  state: FileState;
  file: FileMeta;
  tabs: CodeTab[];
  onCloseTab: (id: string) => void;
}

function CodeRoom(props: CodeRoomProps) {
  const room = useRoom(props.file.id);
  if (!room) return <FullPageSpinner />;
  return <CodeEditor {...props} room={room} />;
}

function CodeEditor({ state, file, tabs, onCloseTab, room }: CodeRoomProps & { room: Room }) {
  const toast = useToast();
  const navigate = useNavigate();
  const theme = useTheme();
  useLiveFile(state, room);
  const status = useRoomStatus(room);
  const people = usePresence(room);

  const canEditFile = canEdit(file.role) && !file.trashedAt && !status.denied;
  const isOwner = file.role === 'owner';
  const dark = theme.resolved === 'dark';

  const ytext = useMemo(() => room.doc.getText(CODE_FIELD), [room]);
  const meta = useMemo(() => room.doc.getMap<unknown>(META_FIELD), [room]);
  const fileSettings = useFileSettings(meta);
  const [storedSettings, setStoredSettings] = useLocalStorage<unknown>('code-settings', null);
  const settings = useMemo(() => readCodeSettings(storedSettings), [storedSettings]);
  const updateSettings = (patch: Partial<CodeSettings>) => setStoredSettings((stored: unknown) => ({ ...readCodeSettings(stored), ...patch }));

  const [store] = useState(() => new ViewStore());
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [resultsQuery, setResultsQuery] = useState<SearchQuery | null>(null);
  const [dialog, setDialog] = useState<CodeDialog | null>(null);
  const [hash, setHash] = useState<{ algorithm: HashAlgorithm; text: string; selection: boolean } | null>(null);
  const [compare, setCompare] = useState<{ current: CompareSource; other: CompareSource } | null>(null);
  const [showVersionChanges, setShowVersionChanges] = useState(false);
  // People who can't edit the file may still choose a language for themselves.
  const [localLanguage, setLocalLanguage] = useState<{ value: string | null } | null>(null);

  const [storedMacro, setStoredMacro] = useLocalStorage<unknown>('code-macro', []);
  const macro = useMemo(() => (Array.isArray(storedMacro) ? storedMacro.filter(isMacroStep) : []), [storedMacro]);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<MacroStep[] | null>(null);
  const playingRef = useRef(false);

  const languageSetting = localLanguage ? localLanguage.value : file.language;
  const language = useMemo(() => resolveLanguage(languageSetting, file.title), [languageSetting, file.title]);
  const detected = useMemo(() => detectLanguage(file.title)?.name ?? null, [file.title]);
  const languageName = language?.name ?? PLAIN_TEXT;

  const editable = loaded && canEditFile;
  const config = useMemo<EditorConfig>(() => ({ settings, file: fileSettings, dark, editable }), [settings, fileSettings, dark, editable]);
  const getConfig = useEffectEvent(() => config);

  useEffect(() => {
    if (view) reconfigureEditor(view, config);
  }, [view, config]);

  useEffect(() => {
    if (!view) return;
    if (editable) removeCarriageReturns(ytext);
    const separator = editable ? NONE : KEEP_CR;
    if (separatorCompartment.get(view.state) !== separator) view.dispatch({ effects: separatorCompartment.reconfigure(separator) });
  }, [view, editable, ytext]);

  // Wait for the server's copy before editing; an opened file's content is added then.
  useEffect(() => {
    let cancelled = false;
    void whenSynced(room).then(() => {
      if (cancelled) return;
      if (canEdit(file.role) && !file.trashedAt) {
        const initial = takeInitialContent(file.id);
        if (initial?.kind === 'text' && ytext.length === 0) {
          const text = normalizeEol(initial.text);
          const indentation = detectIndentation(text);
          room.doc.transact(() => {
            ytext.insert(0, text);
            writeFileSettings(meta, {
              eol: detectEol(initial.text) ?? undefined,
              encoding: initial.encoding,
              useTabs: indentation?.useTabs,
              tabSize: indentation?.size ?? undefined,
            });
          }, 'initial-content');
        }
        removeCarriageReturns(ytext);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [room, ytext, meta, file.id, file.role, file.trashedAt]);

  const onKeyAction = useEffectEvent((action: KeyAction): boolean => {
    // Macros replay keys through the editor's key bindings; those for the page (dialogs, recording) are skipped.
    if (playingRef.current) return false;
    switch (action) {
      case 'goToLine':
        openDialog('goToLine');
        return true;
      case 'find':
        openFind(false);
        return true;
      case 'replace':
        openFind(true);
        return true;
      case 'columnEditor':
        if (!editable) return false;
        openDialog('columnEditor');
        return true;
      case 'toggleWrap':
        updateSettings({ wrap: !settings.wrap });
        return true;
      case 'zoomIn':
        updateSettings({ zoom: stepZoom(settings.zoom, 1) });
        return true;
      case 'zoomOut':
        updateSettings({ zoom: stepZoom(settings.zoom, -1) });
        return true;
      case 'zoomReset':
        updateSettings({ zoom: 100 });
        return true;
      case 'toggleRecording':
        toggleRecording();
        return true;
      case 'playMacro':
        playRecordedMacro();
        return true;
    }
  });

  useEffect(() => {
    if (!loaded || !host.current) return;
    const manager = new Y.UndoManager(ytext);
    const config = getConfig();
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          editorExtensions(config, [
            yCollab(ytext, room.provider.awareness, { undoManager: manager }),
            store.extension,
            macroRecorder((step) => recordingRef.current?.push(step)),
            searchPanel(setPanel),
            codeKeymap((action) => onKeyAction(action)),
            EditorView.contentAttributes.of({ 'aria-label': 'File content' }),
          ]),
          separatorCompartment.of(config.editable ? NONE : KEEP_CR),
        ],
      }),
    });
    setView(created);
    setUndoManager(manager);
    return () => {
      created.destroy();
      manager.destroy();
      setView(null);
      setUndoManager(null);
      setPanel(null);
    };
  }, [loaded, room, ytext, store]);

  // Languages are loaded on demand.
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    const apply = (extension: Extension) => {
      if (!cancelled) view.dispatch({ effects: languageCompartment.reconfigure(extension) });
    };
    if (!language) apply(NONE);
    else if (language.support) apply(language.support);
    else {
      language.load().then(apply, (error: unknown) => {
        if (!cancelled) toast.show(`Could not load ${language.name} highlighting: ${errorMessage(error)}`, { kind: 'error' });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [view, language, toast]);

  // The page itself isn't printable (the editor only draws the visible lines), so a printout replaces it.
  useEffect(() => {
    if (!view) return;
    let printout: HTMLElement | null = null;
    const remove = () => {
      printout?.remove();
      printout = null;
    };
    const add = () => {
      remove();
      printout = buildPrintout(view.state, { title: file.title, lineNumbers: settings.lineNumbers });
      document.body.append(printout);
    };
    window.addEventListener('beforeprint', add);
    window.addEventListener('afterprint', remove);
    return () => {
      remove();
      window.removeEventListener('beforeprint', add);
      window.removeEventListener('afterprint', remove);
    };
  }, [view, file.title, settings.lineNumbers]);

  useEffect(() => {
    document.title = `${file.title} - TitoDocs`;
    return () => {
      document.title = 'TitoDocs';
    };
  }, [file.title]);

  useEffect(() => {
    if (!status.unsynced) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status.unsynced]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!view || !editable || focusedOnce.current) return;
    focusedOnce.current = true;
    view.focus();
  }, [view, editable]);

  // ---------------------------------------------------------------- actions

  const notify = (message: string) => toast.show(message);

  /** Gives the focus back to the editor once a dialog has gone (the editor may have gone too, e.g. after moving to the trash). */
  const focusEditor = () => {
    requestAnimationFrame(() => {
      if (view?.dom.isConnected && !document.querySelector('dialog[open]')) view.focus();
    });
  };

  const closeDialog = () => {
    setDialog(null);
    focusEditor();
  };

  const openDialog = (next: CodeDialog) => {
    if (!view) return;
    if ((next === 'columnEditor' || next === 'runMacro') && !editable) return;
    if ((next === 'versions' || next === 'nameVersion') && !canEditFile) return;
    if (next === 'trash' && !isOwner) return;
    if (next === 'runMacro' && (recordingRef.current || !macro.length)) return;
    setDialog(next);
  };

  const openFind = (replace: boolean) => {
    if (!view) return;
    setSearchRequest((current) => ({ replace: replace && editable, key: (current?.key ?? 0) + 1 }));
    openSearchPanel(view);
  };

  const toggleRecording = () => {
    const steps = recordingRef.current;
    if (steps) {
      recordingRef.current = null;
      setRecording(false);
      if (steps.length) {
        setStoredMacro(steps);
        toast.show(`Recorded a macro: ${describeMacro(steps)}`, { kind: 'success' });
      } else {
        notify('Nothing was recorded.');
      }
      return;
    }
    if (!editable) return;
    recordingRef.current = [];
    setRecording(true);
    notify(`Recording a macro. Press ${keyLabel(KEYS.record)} to stop.`);
  };

  /** Plays the recorded macro and returns how many times it ran. */
  const playSteps = (times: number | 'end'): number => {
    if (!view || !editable || recordingRef.current || !macro.length) return 0;
    playingRef.current = true;
    try {
      return playMacroRepeatedly(view, macro, times);
    } finally {
      playingRef.current = false;
    }
  };

  const playRecordedMacro = () => {
    if (recordingRef.current) notify('Stop recording before playing the macro back.');
    else if (!macro.length) notify(`No macro has been recorded. Press ${keyLabel(KEYS.record)} to record one.`);
    else if (!editable) notify('You can’t edit this file.');
    else playSteps(1);
  };

  const runMacro = (times: number | 'end') => {
    closeDialog();
    const runs = playSteps(times);
    notify(`Ran the macro ${runs.toLocaleString()} ${runs === 1 ? 'time' : 'times'}.`);
  };

  const openHash = (algorithm: HashAlgorithm) => {
    if (!view) return;
    setHash({ algorithm, ...selectionOrDocument(view.state) });
  };

  const closeHash = () => {
    setHash(null);
    focusEditor();
  };

  const print = () => window.print();

  const download = () => {
    if (!view) return;
    try {
      const text = applyEol(normalizeEol(view.state.doc.toString()), fileSettings.eol);
      downloadBlob(new Blob([encodeText(text, fileSettings.encoding)], { type: 'text/plain' }), safeFileName(file.title, 'untitled.txt'));
    } catch (error) {
      toast.error(error);
    }
  };

  const newFile = async () => {
    try {
      const { file: created } = await api.createFile({ type: 'code' });
      navigate(fileUrl(created));
    } catch (error) {
      toast.error(error);
    }
  };

  const openFile = async () => {
    const picked = await pickFile('*/*');
    if (!picked) return;
    try {
      const { text, encoding } = await readTextFile(picked);
      const { file: created } = await api.createFile({ type: 'code', title: picked.name });
      setInitialContent(created.id, { kind: 'text', text, encoding });
      navigate(fileUrl(created));
    } catch (error) {
      toast.show(`Could not open ${picked.name}: ${errorMessage(error)}`, { kind: 'error' });
    }
  };

  const copyText = (text: string, message: string) => {
    const blocked = () => toast.show('Your browser blocked access to the clipboard.', { kind: 'error' });
    if (!navigator.clipboard) {
      blocked();
      return;
    }
    navigator.clipboard.writeText(text).then(() => toast.show(message, { kind: 'success' }), blocked);
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
      onCloseTab(file.id);
      toast.show(`“${file.title}” was moved to the trash`, {
        action: { label: 'Undo', onClick: () => void api.restore(file.id).then(() => navigate(fileUrl(file)), toast.error) },
      });
    } catch (error) {
      toast.error(error);
    }
  };

  const nameVersion = async (value: string) => {
    const name = value.trim();
    if (!name) throw new Error('Enter a name for this version.');
    await api.saveVersion(file.id, name);
    toast.show(`Saved version “${name}”`, { kind: 'success' });
  };

  /** Restoring changes only the text that differs, so collaborators' cursors stay put; it can be undone. */
  const restoreVersion = (doc: Y.Doc) => {
    const change = minimalChange(ytext.toString(), normalizeEol(doc.getText(CODE_FIELD).toString()));
    room.doc.transact(() => {
      if (change) {
        if (change.to > change.from) ytext.delete(change.from, change.to - change.from);
        if (change.insert) ytext.insert(change.from, change.insert);
      }
      writeFileSettings(meta, readFileSettings(doc.getMap(META_FIELD)));
    });
  };

  const setFileSettings = (patch: Partial<FileSettings>) => {
    if (editable) writeFileSettings(meta, patch);
  };

  const detectIndent = () => {
    if (!view) return;
    const found = detectIndentation(view.state.doc.toString());
    if (!found) {
      notify('The file has no indented lines to detect the indentation from.');
      return;
    }
    setFileSettings(found.size ? { useTabs: found.useTabs, tabSize: found.size } : { useTabs: found.useTabs });
    notify(found.useTabs ? 'The file is indented with tabs.' : `The file is indented with ${found.size ?? fileSettings.tabSize} spaces.`);
  };

  const setLanguage = (value: string | null) => {
    if (!canEditFile) {
      setLocalLanguage({ value });
      return;
    }
    setLocalLanguage(null);
    const previous = file.language;
    if (previous === value) return;
    state.setFile((current) => ({ ...current, language: value }));
    api.updateFile(file.id, { language: value }).catch((error: unknown) => {
      state.setFile((current) => ({ ...current, language: previous }));
      toast.error(error);
    });
  };

  const startCompare = (other: CompareSource) => {
    if (!view) return;
    setDialog(null);
    setCompare({ current: { label: file.title, text: normalizeEol(view.state.doc.toString()) }, other });
  };

  const closeCompare = () => {
    setCompare(null);
    requestAnimationFrame(focusEditor);
  };

  const closeResults = () => {
    setResultsQuery(null);
    focusEditor();
  };

  // Shortcuts that work anywhere on the page; those for editing are in `codeKeymap`.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !(isMac ? event.metaKey : event.ctrlKey)) return;
    if (event.getModifierState('AltGraph') || compare || dialog === 'versions' || document.querySelector('dialog[open]')) return;
    const key = keyName(event);
    const { shiftKey: shift, altKey: alt } = event;
    let action: (() => unknown) | null = null;
    if (!shift && !alt) {
      if (key === 'p') action = print;
      else if (key === 'o') action = openFile;
      else if (key === 's') action = () => notify('TitoDocs saves your changes automatically.');
      else if (key === 'f') action = () => openFind(false);
      else if (key === 'g') action = () => openDialog('goToLine');
      else if (key === 'h' && !isMac) action = () => openFind(true);
    } else if (alt && !shift) {
      if (key === 'f' && isMac) action = () => openFind(true);
    } else if (alt && shift) {
      if (key === 'h' && canEditFile) action = () => openDialog('versions');
    }
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const ctx: CodeMenuContext | null =
    view && undoManager
      ? {
          view,
          undoManager,
          canEditFile,
          isOwner,
          title: file.title,
          link: absoluteUrl(fileUrl(file)),
          settings,
          updateSettings,
          file: fileSettings,
          setFileSettings,
          detectIndentation: detectIndent,
          languageSetting,
          detectedLanguage: detected,
          languageName,
          setLanguage,
          theme: theme.setting,
          setTheme: theme.setSetting,
          recording,
          macro,
          toggleRecording,
          playMacro: playRecordedMacro,
          openDialog,
          openHash,
          openFind,
          print,
          download,
          newFile: () => void newFile(),
          openFile: () => void openFile(),
          closeTab: () => onCloseTab(file.id),
          rename,
          copyText,
          notify,
          error: toast.error,
        }
      : null;

  return (
    <div className="code-page">
      <AppHeader
        file={file}
        workspace={state.workspace}
        status={status}
        people={people}
        onFileChange={state.setFile}
        icon={<FileTypeIcon type="code" size={26} />}
        menubar={<MenuBar menus={ctx ? buildCodeMenus(ctx) : LOADING_MENUS} label="Code editor menu" />}
      />
      <TrashedBanner file={file} onRestored={() => void state.reload()} />
      {status.denied && (
        <div className="banner banner-warning" role="alert">
          <Ban size={16} />
          <span>You no longer have access to this file.</span>
        </div>
      )}
      {!canEdit(file.role) && !file.trashedAt && !status.denied && (
        <div className="banner banner-info no-print" data-testid="access-banner">
          <Eye size={16} />
          <span>You can view this file, but not edit it.</span>
        </div>
      )}
      {ctx ? <CodeToolbar ctx={ctx} /> : <div className="app-toolbar code-toolbar no-print" aria-hidden="true" />}
      <Tabs tabs={tabs} current={file.id} onClose={onCloseTab} onNew={() => void newFile()} />
      <div className="code-body">
        <div className="code-editor-host" ref={host} data-testid="code-editor" />
        {!view && !status.denied && (
          <div className="code-loading">
            <Spinner label="Loading file" />
          </div>
        )}
        {view && resultsQuery && <ResultsPanel view={view} store={store} query={resultsQuery} onClose={closeResults} />}
      </div>
      {view && (
        <StatusBar
          view={view}
          store={store}
          language={languageName}
          file={fileSettings}
          zoom={settings.zoom}
          editable={editable}
          recording={recording}
          onLanguage={() => openDialog('language')}
          onGoToLine={() => openDialog('goToLine')}
          onFileSettings={setFileSettings}
          onDetectIndentation={detectIndent}
          onZoom={(zoom) => updateSettings({ zoom })}
          onStopRecording={toggleRecording}
        />
      )}
      {view && panel && (
        <SearchPanel view={view} store={store} container={panel} request={searchRequest} canReplace={editable} onFindAll={setResultsQuery} notify={notify} />
      )}

      {view && dialog === 'goToLine' && (
        <GoToLineDialog
          state={view.state}
          onGo={(line, column) => {
            closeDialog();
            goToLine(view, line, column);
          }}
          onClose={closeDialog}
        />
      )}
      {view && dialog === 'columnEditor' && (
        <ColumnEditorDialog
          count={columnTargets(view.state).length}
          onInsert={(texts) => {
            closeDialog();
            columnInsert(view, texts);
          }}
          onClose={closeDialog}
        />
      )}
      {dialog === 'language' && <LanguageDialog current={languageSetting} detected={detected} onSelect={setLanguage} onClose={closeDialog} />}
      {view && dialog === 'summary' && <SummaryDialog state={view.state} file={file} settings={fileSettings} onClose={closeDialog} />}
      {dialog === 'compare' && <CompareDialog file={file} canSeeVersions={canEditFile} onCompare={startCompare} onClose={closeDialog} />}
      {dialog === 'runMacro' && <RunMacroDialog steps={macro} onRun={runMacro} onClose={closeDialog} />}
      {dialog === 'shortcuts' && <ShortcutsDialog groups={CODE_SHORTCUTS} onClose={closeDialog} />}
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
        <VersionHistory
          file={file}
          renderPreview={(doc) => (
            <CodePreview
              doc={doc}
              ytext={ytext}
              language={language}
              dark={dark}
              showChanges={showVersionChanges}
              onShowChanges={setShowVersionChanges}
            />
          )}
          onRestore={restoreVersion}
          onClose={closeDialog}
        />
      )}
      {hash && (
        <HashDialog
          initial={hash.algorithm}
          text={hash.text}
          selection={hash.selection}
          eol={fileSettings.eol}
          onCopy={(value) => copyText(value, 'Copied the hash')}
          onClose={closeHash}
        />
      )}
      {compare && <CompareView current={compare.current} other={compare.other} language={language} file={fileSettings} dark={dark} onClose={closeCompare} />}
    </div>
  );
}

interface CodePreviewProps {
  doc: Y.Doc;
  /** The file's live text, to show the changes made since the version. */
  ytext: Y.Text;
  language: LanguageDescription | null;
  dark: boolean;
  showChanges: boolean;
  onShowChanges: (show: boolean) => void;
}

/** A saved version in the version history, optionally with the changes made since then. */
function CodePreview({ doc, ytext, language, dark, showChanges, onShowChanges }: CodePreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const versionText = useMemo(() => normalizeEol(doc.getText(CODE_FIELD).toString()), [doc]);
  const settings = useMemo(() => readFileSettings(doc.getMap(META_FIELD)), [doc]);
  // The file as it was when this version was opened (or when the changes were turned on).
  const [current, setCurrent] = useState(() => normalizeEol(ytext.toString()));

  useEffect(() => {
    const extensions = viewerExtensions({ dark, file: settings, language });
    const view = showChanges
      ? new EditorView({
          parent: host.current!,
          doc: current,
          extensions: [
            extensions,
            unifiedMergeView({ original: versionText, mergeControls: false, gutter: true, highlightChanges: true, collapseUnchanged: { margin: 3, minSize: 8 } }),
          ],
        })
      : new EditorView({ parent: host.current!, doc: versionText, extensions });
    return () => view.destroy();
  }, [showChanges, current, versionText, settings, language, dark]);

  return (
    <div className="code-preview">
      <div className="code-preview-toolbar">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={showChanges}
            onChange={(event) => {
              setCurrent(normalizeEol(ytext.toString()));
              onShowChanges(event.target.checked);
            }}
            data-testid="version-show-changes"
          />
          Show changes made since this version
        </label>
        {showChanges && current === versionText && <span className="muted">The file hasn’t changed since this version.</span>}
      </div>
      <div className="code-preview-host" ref={host} data-testid="version-code" />
    </div>
  );
}
