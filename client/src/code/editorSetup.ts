// Configuration of the code editor (CodeMirror): settings, compartments, themes and key bindings.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord } from '@codemirror/autocomplete';
import { copyLineDown, cursorMatchingBracket, defaultKeymap, deleteLine, indentLess, moveLineDown, moveLineUp, selectMatchingBracket } from '@codemirror/commands';
import {
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  type LanguageDescription,
} from '@codemirror/language';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, highlightSelectionMatches, search, selectNextOccurrence } from '@codemirror/search';
import { Compartment, EditorState, Prec, RangeSetBuilder, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  crosshairCursor,
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  WidgetType,
  type Command,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { showMinimap } from '@replit/codemirror-minimap';
import { yUndoManagerKeymap } from 'y-codemirror.next';
import type * as Y from 'yjs';
import { isMac, shortcut } from '../lib/util';
import { bookmarks, nextBookmark, previousBookmark, toggleBookmark } from './bookmarks';
import { changeCase, insertBlankLine, insertIndent, joinLinesCommand, selectAndFind } from './commands';
import { isEol, isTextEncoding, joinLines, type Eol, type TextEncodingName } from './textOps';

// ------------------------------------------------------------------ settings

/** View settings, kept per browser like Notepad++'s preferences. */
export interface CodeSettings {
  wrap: boolean;
  whitespace: boolean;
  eolMarkers: boolean;
  lineNumbers: boolean;
  indentGuides: boolean;
  minimap: boolean;
  activeLine: boolean;
  folding: boolean;
  autocomplete: boolean;
  closeBrackets: boolean;
  /** Font size, in percent of the default size. */
  zoom: number;
}

export const DEFAULT_CODE_SETTINGS: CodeSettings = {
  wrap: false,
  whitespace: false,
  eolMarkers: false,
  lineNumbers: true,
  indentGuides: true,
  minimap: false,
  activeLine: true,
  folding: true,
  autocomplete: true,
  closeBrackets: true,
  zoom: 100,
};

export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

/** Settings read from storage, with defaults for missing or invalid values. */
export function readCodeSettings(stored: unknown): CodeSettings {
  const settings: CodeSettings = { ...DEFAULT_CODE_SETTINGS };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(settings) as (keyof CodeSettings)[]) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === typeof settings[key]) Object.assign(settings, { [key]: value });
    }
  }
  if (!ZOOM_STEPS.includes(settings.zoom)) settings.zoom = 100;
  return settings;
}

export function stepZoom(zoom: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.indexOf(zoom);
  const next = (index < 0 ? ZOOM_STEPS.indexOf(100) : index) + direction;
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, next))]!;
}

/** Settings stored in the file and shared with collaborators: line endings and encoding (used when downloading) and indentation. */
export interface FileSettings {
  eol: Eol;
  encoding: TextEncodingName;
  tabSize: number;
  useTabs: boolean;
}

export const DEFAULT_FILE_SETTINGS: FileSettings = { eol: 'lf', encoding: 'utf-8', tabSize: 4, useTabs: false };

export const TAB_SIZES = [2, 3, 4, 8];

const isTabSize = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16;

export function readFileSettings(meta: Y.Map<unknown>): FileSettings {
  const eol = meta.get('eol');
  const encoding = meta.get('encoding');
  const tabSize = meta.get('tabSize');
  const useTabs = meta.get('useTabs');
  return {
    eol: isEol(eol) ? eol : DEFAULT_FILE_SETTINGS.eol,
    encoding: isTextEncoding(encoding) ? encoding : DEFAULT_FILE_SETTINGS.encoding,
    tabSize: isTabSize(tabSize) ? tabSize : DEFAULT_FILE_SETTINGS.tabSize,
    useTabs: typeof useTabs === 'boolean' ? useTabs : DEFAULT_FILE_SETTINGS.useTabs,
  };
}

export function writeFileSettings(meta: Y.Map<unknown>, settings: Partial<FileSettings>): void {
  const write = () => {
    for (const [key, value] of Object.entries(settings)) if (value !== undefined) meta.set(key, value);
  };
  if (meta.doc) meta.doc.transact(write);
  else write();
}

const sameFileSettings = (a: FileSettings, b: FileSettings): boolean =>
  a.eol === b.eol && a.encoding === b.encoding && a.tabSize === b.tabSize && a.useTabs === b.useTabs;

export function useFileSettings(meta: Y.Map<unknown>): FileSettings {
  const [settings, setSettings] = useState(() => readFileSettings(meta));
  useEffect(() => {
    const update = () => {
      const next = readFileSettings(meta);
      setSettings((current) => (sameFileSettings(current, next) ? current : next));
    };
    update();
    meta.observe(update);
    return () => meta.unobserve(update);
  }, [meta]);
  return settings;
}

// ------------------------------------------------------------------ extensions

const NONE: Extension = [];

/** Shared by the editor and the read-only viewers (version preview, compare). */
const sharedTheme = EditorView.theme({
  '&': { height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-gutters': { borderRight: '1px solid var(--border)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
});

const LIGHT_THEME: Extension = [
  EditorView.theme({
    '&': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
    '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' },
  }),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
];
const DARK_THEME: Extension = [oneDark, syntaxHighlighting(defaultHighlightStyle, { fallback: true })];

const READ_ONLY = EditorState.readOnly.of(true);
const WHITESPACE = highlightWhitespace();
const LINE_NUMBERS = lineNumbers();
const FOLD_GUTTER = foldGutter();
const INDENT_GUIDES = indentationMarkers();
const MINIMAP = showMinimap.of({ create: () => ({ dom: document.createElement('div') }), displayText: 'blocks', showOverlay: 'always' });
const ACTIVE_LINE = [highlightActiveLine(), highlightActiveLineGutter()];
// Words from the document are suggested in every language, besides the language's own completions.
const AUTOCOMPLETE = [autocompletion(), EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }])];
const CLOSE_BRACKETS = [closeBrackets(), keymap.of(closeBracketsKeymap)];

/** Extensions are cached so reconfiguring with unchanged settings keeps them (and their state). */
function cached<K, V>(create: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, create(key));
    return cache.get(key)!;
  };
}

const zoomTheme = cached((zoom: number) => EditorView.theme({ '&': { fontSize: `${(14 * zoom) / 100}px` } }));

const tabExtension = cached((key: string) => {
  const [useTabs, size] = key.split(':');
  const tabSize = Number(size);
  return [EditorState.tabSize.of(tabSize), indentUnit.of(useTabs === 'tabs' ? '\t' : ' '.repeat(tabSize))];
});
const tabs = (file: Pick<FileSettings, 'tabSize' | 'useTabs'>): Extension => tabExtension(`${file.useTabs ? 'tabs' : 'spaces'}:${file.tabSize}`);

export const EOL_SHORT_LABELS: Record<Eol, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' };

class EolWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  override eq(other: EolWidget): boolean {
    return other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'cm-eol-marker';
    marker.textContent = this.label;
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }
}

/** Notepad++'s "Show end of line": the file's line ending, drawn at the end of each line. */
const eolMarkers = cached((eol: Eol) => {
  const widget = Decoration.widget({ widget: new EolWidget(EOL_SHORT_LABELS[eol]), side: 1 });
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const { doc } = view.state;
    let last = -1;
    for (const { from, to } of view.visibleRanges) {
      for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
        if (line.number < doc.lines && line.to > last) {
          builder.add(line.to, line.to, widget);
          last = line.to;
        }
        if (line.to >= to || line.number >= doc.lines) break;
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
});

export interface EditorConfig {
  settings: CodeSettings;
  file: FileSettings;
  dark: boolean;
  editable: boolean;
}

const compartments = {
  lineNumbers: new Compartment(),
  folding: new Compartment(),
  activeLine: new Compartment(),
  tabs: new Compartment(),
  readOnly: new Compartment(),
  wrap: new Compartment(),
  whitespace: new Compartment(),
  eolMarkers: new Compartment(),
  indentGuides: new Compartment(),
  minimap: new Compartment(),
  autocomplete: new Compartment(),
  closeBrackets: new Compartment(),
  theme: new Compartment(),
  zoom: new Compartment(),
};
type CompartmentName = keyof typeof compartments;

/** The language is loaded on demand, so it is set separately from the other settings. */
export const languageCompartment = new Compartment();

function configValues({ settings, file, dark, editable }: EditorConfig): Record<CompartmentName, Extension> {
  return {
    lineNumbers: settings.lineNumbers ? LINE_NUMBERS : NONE,
    folding: settings.folding ? FOLD_GUTTER : NONE,
    activeLine: settings.activeLine ? ACTIVE_LINE : NONE,
    tabs: tabs(file),
    readOnly: editable ? NONE : READ_ONLY,
    wrap: settings.wrap ? EditorView.lineWrapping : NONE,
    whitespace: settings.whitespace ? WHITESPACE : NONE,
    eolMarkers: settings.eolMarkers ? eolMarkers(file.eol) : NONE,
    indentGuides: settings.indentGuides ? INDENT_GUIDES : NONE,
    minimap: settings.minimap ? MINIMAP : NONE,
    autocomplete: settings.autocomplete && editable ? AUTOCOMPLETE : NONE,
    closeBrackets: settings.closeBrackets ? CLOSE_BRACKETS : NONE,
    theme: dark ? DARK_THEME : LIGHT_THEME,
    zoom: zoomTheme(settings.zoom),
  };
}

/** yCollab's undo and redo change the shared text even when the editor is read-only (e.g. after losing edit access). */
const undoKeymap: KeyBinding[] = yUndoManagerKeymap.map((binding) => ({
  ...binding,
  run: (view) => view.state.readOnly || (binding.run?.(view) ?? false),
}));

/** All extensions of the code editor; `extra` holds collaboration, key bindings and listeners. */
export function editorExtensions(config: EditorConfig, extra: Extension[]): Extension[] {
  const values = configValues(config);
  return [
    ...extra,
    compartments.lineNumbers.of(values.lineNumbers),
    // Bookmarks are drawn between the line numbers and the fold markers, as in Notepad++.
    bookmarks,
    ...(Object.keys(compartments) as CompartmentName[]).filter((name) => name !== 'lineNumbers').map((name) => compartments[name].of(values[name])),
    languageCompartment.of(NONE),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    codeFolding(),
    sharedTheme,
    keymap.of([...defaultKeymap, ...foldKeymap, ...undoKeymap]),
  ];
}

/** Applies changed settings to a running editor. */
export function reconfigureEditor(view: EditorView, config: EditorConfig): void {
  const values = configValues(config);
  const effects = (Object.keys(compartments) as CompartmentName[])
    .filter((name) => compartments[name].get(view.state) !== values[name])
    .map((name) => compartments[name].reconfigure(values[name]));
  if (effects.length) view.dispatch({ effects });
}

/** Extensions of the read-only viewers (saved versions, compare). */
export function viewerExtensions({ dark, file, language }: { dark: boolean; file: FileSettings; language: LanguageDescription | null }): Extension {
  return [
    READ_ONLY,
    LINE_NUMBERS,
    highlightSpecialChars(),
    drawSelection(),
    tabs(file),
    language?.support ?? NONE,
    dark ? DARK_THEME : LIGHT_THEME,
    sharedTheme,
  ];
}

/** A search panel rendered by React: CodeMirror creates the container and `onPanel` receives it. */
export const searchPanel = (onPanel: (dom: HTMLElement | null) => void): Extension =>
  search({
    top: true,
    literal: true,
    createPanel: () => {
      const dom = document.createElement('div');
      dom.className = 'code-search-host';
      return { dom, top: true, mount: () => onPanel(dom), destroy: () => onPanel(null) };
    },
  });

// ------------------------------------------------------------------ key bindings

/** Alt+letter types characters on macOS, so those shortcuts use Ctrl+Alt there. */
const altKey = (key: string): string => (isMac ? `Ctrl-${key}` : key);

/** Key bindings, in CodeMirror's notation; `keyLabel` formats them for menus. */
export const KEYS = {
  undo: 'Mod-z',
  redo: isMac ? 'Mod-Shift-z' : 'Mod-y',
  selectAll: 'Mod-a',
  find: 'Mod-f',
  // Cmd+H hides the browser on macOS.
  replace: isMac ? 'Mod-Alt-f' : 'Mod-h',
  findNext: 'F3',
  findPrevious: 'Shift-F3',
  selectFindNext: 'Mod-F3',
  selectFindPrevious: 'Mod-Shift-F3',
  selectNextOccurrence: 'Mod-Shift-d',
  goToLine: 'Mod-g',
  matchingBracket: 'Mod-b',
  selectToBracket: 'Mod-Alt-b',
  toggleBookmark: 'Mod-F2',
  nextBookmark: 'F2',
  previousBookmark: 'Shift-F2',
  duplicateLine: 'Mod-d',
  deleteLine: 'Mod-Shift-l',
  moveLineUp: 'Alt-ArrowUp',
  moveLineDown: 'Alt-ArrowDown',
  joinLines: 'Mod-j',
  lowerCase: 'Mod-u',
  upperCase: 'Mod-Shift-u',
  properCase: altKey('Alt-u'),
  sentenceCase: 'Mod-Alt-u',
  toggleComment: 'Mod-/',
  toggleBlockComment: 'Alt-Shift-a',
  blankLineAbove: 'Mod-Alt-Enter',
  blankLineBelow: 'Mod-Alt-Shift-Enter',
  indent: 'Tab',
  outdent: 'Shift-Tab',
  fold: isMac ? 'Mod-Alt-[' : 'Ctrl-Shift-[',
  unfold: isMac ? 'Mod-Alt-]' : 'Ctrl-Shift-]',
  foldAll: 'Ctrl-Alt-[',
  unfoldAll: 'Ctrl-Alt-]',
  columnEditor: altKey('Alt-c'),
  wrap: altKey('Alt-z'),
  zoomIn: 'Mod-=',
  zoomOut: 'Mod--',
  zoomReset: 'Mod-0',
  record: 'Mod-Shift-r',
  playback: 'Mod-Shift-p',
  open: 'Mod-o',
  print: 'Mod-p',
  versions: 'Mod-Alt-Shift-h',
} as const;

const ARROWS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** A key binding in the notation of `shortcut()`, with arrows for the arrow keys. */
export const displayKeys = (key: string): string => key.replace(/Arrow(Up|Down|Left|Right)/, (name) => ARROWS[name]!);

export const keyLabel = (key: string): string => shortcut(displayKeys(key));

/** Shortcuts that need the page (dialogs, settings, macros). */
export type KeyAction = 'goToLine' | 'find' | 'replace' | 'columnEditor' | 'toggleWrap' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'toggleRecording' | 'playMacro';

export function codeKeymap(run: (action: KeyAction) => boolean): Extension {
  const action =
    (name: KeyAction): Command =>
    () =>
      run(name);
  const selectFind = (forward: boolean): Command => (view) => selectAndFind(view, forward, getSearchQuery(view.state));
  const bindings: KeyBinding[] = [
    { key: KEYS.duplicateLine, run: copyLineDown, preventDefault: true },
    { key: KEYS.selectNextOccurrence, run: selectNextOccurrence, preventDefault: true },
    { key: KEYS.deleteLine, run: deleteLine, preventDefault: true },
    // Notepad++'s keys for moving lines; on macOS, Cmd+Shift+↑/↓ select to the start/end of the document.
    ...(isMac ? [] : [{ key: 'Mod-Shift-ArrowUp', run: moveLineUp }, { key: 'Mod-Shift-ArrowDown', run: moveLineDown }]),
    { key: KEYS.joinLines, run: (view) => joinLinesCommand(view, joinLines), preventDefault: true },
    { key: KEYS.lowerCase, run: (view) => changeCase(view, 'lower'), preventDefault: true },
    { key: KEYS.upperCase, run: (view) => changeCase(view, 'upper'), preventDefault: true },
    { key: KEYS.properCase, run: (view) => changeCase(view, 'proper'), preventDefault: true },
    { key: KEYS.sentenceCase, run: (view) => changeCase(view, 'sentence'), preventDefault: true },
    { key: KEYS.blankLineAbove, run: (view) => insertBlankLine(view, true) },
    { key: KEYS.blankLineBelow, run: (view) => insertBlankLine(view, false) },
    { key: KEYS.goToLine, run: action('goToLine'), preventDefault: true },
    { key: KEYS.matchingBracket, run: cursorMatchingBracket, preventDefault: true },
    { key: KEYS.selectToBracket, run: selectMatchingBracket, preventDefault: true },
    { key: KEYS.find, run: action('find'), scope: 'editor search-panel', preventDefault: true },
    { key: KEYS.replace, run: action('replace'), scope: 'editor search-panel', preventDefault: true },
    { key: 'F3', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
    { key: 'Mod-F3', run: selectFind(true), shift: selectFind(false), scope: 'editor search-panel', preventDefault: true },
    { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
    { key: KEYS.toggleBookmark, run: toggleBookmark, preventDefault: true },
    { key: 'F2', run: nextBookmark, shift: previousBookmark, preventDefault: true },
    { key: KEYS.columnEditor, run: action('columnEditor'), preventDefault: true },
    { key: KEYS.wrap, run: action('toggleWrap'), preventDefault: true },
    { key: KEYS.zoomIn, run: action('zoomIn'), preventDefault: true },
    { key: 'Mod-+', run: action('zoomIn'), preventDefault: true },
    { key: KEYS.zoomOut, run: action('zoomOut'), preventDefault: true },
    { key: KEYS.zoomReset, run: action('zoomReset'), preventDefault: true },
    { key: KEYS.record, run: action('toggleRecording'), preventDefault: true },
    { key: KEYS.playback, run: action('playMacro'), preventDefault: true },
    { key: KEYS.indent, run: insertIndent, shift: indentLess },
  ];
  return Prec.high(keymap.of(bindings));
}

// ------------------------------------------------------------------ React bindings

/** Lets React components follow the editor state (cursor position, selection, ...). */
export class ViewStore {
  private readonly listeners = new Set<() => void>();

  readonly extension = EditorView.updateListener.of((update) => {
    if (update.transactions.length) for (const listener of this.listeners) listener();
  });

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const useViewState = (store: ViewStore, view: EditorView): EditorState => useSyncExternalStore(store.subscribe, () => view.state);

const UNDO_EVENTS = ['stack-item-added', 'stack-item-popped', 'stack-cleared', 'stack-item-updated'] as const;

export function useUndoState(undoManager: Y.UndoManager | null): { canUndo: boolean; canRedo: boolean } {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!undoManager) return () => {};
      for (const name of UNDO_EVENTS) undoManager.on(name, listener);
      return () => {
        for (const name of UNDO_EVENTS) undoManager.off(name, listener);
      };
    },
    [undoManager],
  );
  const canUndo = useSyncExternalStore(subscribe, () => !!undoManager?.undoStack.length);
  const canRedo = useSyncExternalStore(subscribe, () => !!undoManager?.redoStack.length);
  return { canUndo, canRedo };
}
