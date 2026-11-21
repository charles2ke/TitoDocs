// The code editor's menu bar and toolbar, modelled on Notepad++'s menus.
import {
  blockComment,
  blockUncomment,
  copyLineDown,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  lineComment,
  lineUncomment,
  moveLineDown,
  moveLineUp,
  selectAll,
  selectMatchingBracket,
  toggleBlockComment,
  toggleComment,
  type CommentTokens,
} from '@codemirror/commands';
import { foldAll, foldCode, unfoldAll, unfoldCode } from '@codemirror/language';
import { findNext, findPrevious, getSearchQuery, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import type { Command, EditorView } from '@codemirror/view';
import type * as Y from 'yjs';
import {
  Binary,
  Bookmark,
  Braces,
  CalendarPlus,
  CaseSensitive,
  Circle,
  ClipboardCopy,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  Expand,
  FilePlus,
  FolderOpen,
  GitCompareArrows,
  Hash,
  History,
  Info,
  Keyboard,
  ListIndentIncrease,
  ListOrdered,
  MapIcon,
  MessageSquareCode,
  Pencil,
  Pilcrow,
  Play,
  Printer,
  Redo2,
  Repeat,
  Replace,
  Rows3,
  Scissors,
  Search,
  Space,
  Square,
  SunMoon,
  TextWrap,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import type { MenuBarMenu, MenuEntry } from '../components/Menu';
import { ToolButton, ToolDivider } from '../components/Toolbar';
import { isMac, shortcut } from '../lib/util';
import type { ThemeSetting } from '../theme';
import {
  bookmarkedLines,
  bookmarkedText,
  clearBookmarks,
  inverseBookmarks,
  nextBookmark,
  previousBookmark,
  removeBookmarkedLines,
  removeUnmarkedLines,
  toggleBookmark,
} from './bookmarks';
import {
  changeCase,
  clipboardCommand,
  insertBlankLine,
  insertText,
  joinLinesCommand,
  pasteFromClipboard,
  selectAndFind,
  transformLines,
  transformSelections,
} from './commands';
import { HASH_ALGORITHMS } from './dialogs';
import { EOL_SHORT_LABELS, keyLabel, KEYS, stepZoom, TAB_SIZES, useUndoState, ZOOM_STEPS, type CodeSettings, type FileSettings } from './editorSetup';
import { languageGroups, PLAIN_TEXT } from './languages';
import { describeMacro, type MacroStep } from './macro';
import {
  base64Decode,
  base64Encode,
  ENCODING_LABELS,
  EOL_LABELS,
  escapeHtmlText,
  formatJson,
  joinLines,
  leadingSpacesToTabs,
  minifyJson,
  removeConsecutiveDuplicateLines,
  removeDuplicateLines,
  removeEmptyLines,
  reverseLines,
  shuffleLines,
  sortLines,
  tabsToSpaces,
  trimBoth,
  trimLeading,
  trimTrailing,
  unescapeHtmlText,
  urlDecode,
  urlEncode,
  type CaseMode,
  type Eol,
  type HashAlgorithm,
  type SortMode,
  type TextEncodingName,
} from './textOps';

export type CodeDialog =
  | 'goToLine'
  | 'columnEditor'
  | 'language'
  | 'summary'
  | 'compare'
  | 'runMacro'
  | 'shortcuts'
  | 'versions'
  | 'nameVersion'
  | 'trash'
  | 'copy';

export interface CodeMenuContext {
  view: EditorView;
  undoManager: Y.UndoManager;
  /** The user may edit the file (role, not in the trash, access not revoked). */
  canEditFile: boolean;
  isOwner: boolean;
  title: string;
  /** The file's address, for "Copy link". */
  link: string;
  settings: CodeSettings;
  updateSettings: (patch: Partial<CodeSettings>) => void;
  file: FileSettings;
  setFileSettings: (patch: Partial<FileSettings>) => void;
  detectIndentation: () => void;
  /** The file's language setting: a language name, `PLAIN_TEXT`, or null to detect it from the file name. */
  languageSetting: string | null;
  /** The language detected from the file name. */
  detectedLanguage: string | null;
  /** The name of the language in use. */
  languageName: string;
  setLanguage: (language: string | null) => void;
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  recording: boolean;
  macro: readonly MacroStep[];
  toggleRecording: () => void;
  playMacro: () => void;
  openDialog: (dialog: CodeDialog) => void;
  openHash: (algorithm: HashAlgorithm) => void;
  openFind: (replace: boolean) => void;
  print: () => void;
  download: () => void;
  newFile: () => void;
  openFile: () => void;
  closeTab: () => void;
  rename: () => void;
  copyText: (text: string, message: string) => void;
  notify: (message: string) => void;
  error: (error: unknown) => void;
}

const icon = (Icon: LucideIcon) => <Icon size={16} />;

const MENU_LABELS = ['File', 'Edit', 'Search', 'View', 'Encoding', 'Language', 'Settings', 'Tools', 'Macro', 'Help'];

/** Shown until the editor is ready, so the menu bar doesn't jump. */
export const LOADING_MENUS: MenuBarMenu[] = MENU_LABELS.map((label) => ({ label, items: [{ type: 'label', label: 'Loading…' }] }));

const CASES: [CaseMode, string, string?][] = [
  ['upper', 'UPPERCASE', KEYS.upperCase],
  ['lower', 'lowercase', KEYS.lowerCase],
  ['proper', 'Proper Case', KEYS.properCase],
  ['sentence', 'Sentence case', KEYS.sentenceCase],
  ['invert', 'iNVERT cASE'],
  ['random', 'ranDOm CasE'],
];

const SORTS: [SortMode, string][] = [
  ['asc', 'Sort lines lexicographically ascending'],
  ['desc', 'Sort lines lexicographically descending'],
  ['ascIgnoreCase', 'Sort lines ascending, ignoring case'],
  ['descIgnoreCase', 'Sort lines descending, ignoring case'],
  ['numberAsc', 'Sort lines as numbers ascending'],
  ['numberDesc', 'Sort lines as numbers descending'],
  ['lengthAsc', 'Sort lines by length ascending'],
  ['lengthDesc', 'Sort lines by length descending'],
];

const THEMES: [ThemeSetting, string][] = [
  ['light', 'Light theme'],
  ['dark', 'Dark theme'],
  ['system', 'Use system theme'],
];

const EOLS: Eol[] = ['crlf', 'lf', 'cr'];

/** JSON tools keep the text's final line break, which `JSON.stringify` would drop. */
const keepFinalNewline =
  (transform: (text: string) => string) =>
  (text: string): string => {
    const result = transform(text);
    return text.endsWith('\n') && !result.endsWith('\n') ? `${result}\n` : result;
  };

const plural = (count: number, word: string): string => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

export function buildCodeMenus(ctx: CodeMenuContext): MenuBarMenu[] {
  const { view, settings, file } = ctx;
  // Menus are built when they open, so this reads the editor's current state.
  const editable = () => !view.state.readOnly;

  /** Runs an editor command from a menu (which has taken the focus) and gives the focus back to the editor. */
  const run = (action: () => unknown) => () => {
    action();
    view.focus();
  };
  const command = (cmd: Command, failure?: string) =>
    run(() => {
      if (!cmd(view) && failure) ctx.notify(failure);
    });
  const lines = (transform: (lines: string[]) => string[]) => run(() => transformLines(view, transform));
  const transform = (fn: (text: string) => string) =>
    run(() => {
      try {
        transformSelections(view, fn);
      } catch (error) {
        ctx.error(error);
      }
    });
  const toggle = (key: keyof CodeSettings) => run(() => ctx.updateSettings({ [key]: !settings[key] }));

  /** Comment commands do nothing in languages without comments, so they explain why instead. */
  const comment = (cmd: Command, kind: 'any' | 'line' | 'block') =>
    run(() => {
      const { state } = view;
      const tokens: CommentTokens = state.languageDataAt<CommentTokens>('commentTokens', state.doc.lineAt(state.selection.main.from).from)[0] ?? {};
      const available = kind === 'line' ? !!tokens.line : kind === 'block' ? !!tokens.block : !!(tokens.line || tokens.block);
      if (available) cmd(view);
      else ctx.notify(`${ctx.languageName} has no ${kind === 'any' ? '' : `${kind} `}comments.`);
    });

  const fileMenu = (): MenuEntry[] => [
    { label: 'New file', icon: icon(FilePlus), onSelect: ctx.newFile, testId: 'menu-new-file' },
    { label: 'Open file…', icon: icon(FolderOpen), shortcut: keyLabel(KEYS.open), onSelect: ctx.openFile },
    { label: 'Make a copy', icon: icon(Copy), onSelect: () => ctx.openDialog('copy'), testId: 'menu-make-copy' },
    { label: 'Close tab', icon: icon(X), onSelect: ctx.closeTab },
    { type: 'separator' },
    {
      label: 'Download',
      icon: icon(Download),
      shortcut: `${ENCODING_LABELS[file.encoding]} · ${EOL_SHORT_LABELS[file.eol]}`,
      onSelect: ctx.download,
      testId: 'menu-download',
    },
    { label: 'Print', icon: icon(Printer), shortcut: keyLabel(KEYS.print), onSelect: ctx.print },
    { type: 'separator' },
    { label: 'Rename', icon: icon(Pencil), disabled: !ctx.canEditFile, onSelect: ctx.rename },
    ...(ctx.isOwner ? [{ label: 'Move to trash', icon: icon(Trash2), onSelect: () => ctx.openDialog('trash') } satisfies MenuEntry] : []),
    ...(ctx.canEditFile
      ? ([
          { type: 'separator' },
          {
            label: 'Version history',
            icon: icon(History),
            submenu: [
              { label: 'Name current version', onSelect: () => ctx.openDialog('nameVersion') },
              { label: 'See version history', shortcut: keyLabel(KEYS.versions), onSelect: () => ctx.openDialog('versions'), testId: 'menu-versions' },
            ],
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  const editMenu = (): MenuEntry[] => {
    const canEdit = editable();
    const now = new Date();
    return [
      {
        label: 'Undo',
        icon: icon(Undo2),
        shortcut: keyLabel(KEYS.undo),
        disabled: !canEdit || !ctx.undoManager.undoStack.length,
        onSelect: run(() => ctx.undoManager.undo()),
      },
      {
        label: 'Redo',
        icon: icon(Redo2),
        shortcut: keyLabel(KEYS.redo),
        disabled: !canEdit || !ctx.undoManager.redoStack.length,
        onSelect: run(() => ctx.undoManager.redo()),
      },
      { type: 'separator' },
      {
        label: 'Cut',
        icon: icon(Scissors),
        shortcut: shortcut('Mod-x'),
        disabled: !canEdit,
        onSelect: () => clipboardCommand(view, 'cut') || ctx.notify(`Use ${shortcut('Mod-x')} to cut.`),
      },
      {
        label: 'Copy',
        icon: icon(Copy),
        shortcut: shortcut('Mod-c'),
        onSelect: () => clipboardCommand(view, 'copy') || ctx.notify(`Use ${shortcut('Mod-c')} to copy.`),
      },
      {
        label: 'Paste',
        icon: icon(ClipboardPaste),
        shortcut: shortcut('Mod-v'),
        disabled: !canEdit,
        onSelect: () =>
          void pasteFromClipboard(view).then((ok) => ok || ctx.notify(`Your browser blocked access to the clipboard. Use ${shortcut('Mod-v')} to paste.`)),
      },
      { label: 'Select all', shortcut: keyLabel(KEYS.selectAll), onSelect: command(selectAll) },
      { type: 'separator' },
      {
        label: 'Insert',
        icon: icon(CalendarPlus),
        disabled: !canEdit,
        submenu: [
          { label: 'Date and time (short)', onSelect: run(() => insertText(view, now.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))) },
          { label: 'Date and time (long)', onSelect: run(() => insertText(view, now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }))) },
          { label: 'Date and time (ISO 8601)', onSelect: run(() => insertText(view, now.toISOString())) },
          { label: 'File name', onSelect: run(() => insertText(view, ctx.title)) },
        ],
      },
      {
        label: 'Copy to clipboard',
        icon: icon(ClipboardCopy),
        submenu: [
          { label: 'File name', onSelect: () => ctx.copyText(ctx.title, 'Copied the file name') },
          { label: 'Link to this file', onSelect: () => ctx.copyText(ctx.link, 'Copied the link') },
        ],
      },
      { type: 'separator' },
      {
        label: 'Indent',
        icon: icon(ListIndentIncrease),
        disabled: !canEdit,
        submenu: [
          { label: 'Increase line indent', shortcut: keyLabel(KEYS.indent), onSelect: command(indentMore) },
          { label: 'Decrease line indent', shortcut: keyLabel(KEYS.outdent), onSelect: command(indentLess) },
        ],
      },
      {
        label: 'Convert case to',
        icon: icon(CaseSensitive),
        disabled: !canEdit,
        submenu: CASES.map(([mode, label, keys]) => ({ label, shortcut: keys && keyLabel(keys), onSelect: run(() => changeCase(view, mode)) })),
      },
      {
        label: 'Line operations',
        icon: icon(Rows3),
        disabled: !canEdit,
        testId: 'menu-line-operations',
        submenu: [
          { label: 'Duplicate current line', shortcut: keyLabel(KEYS.duplicateLine), onSelect: command(copyLineDown) },
          { label: 'Remove duplicate lines', onSelect: lines(removeDuplicateLines), testId: 'menu-remove-duplicates' },
          { label: 'Remove consecutive duplicate lines', onSelect: lines(removeConsecutiveDuplicateLines) },
          { label: 'Join lines', shortcut: keyLabel(KEYS.joinLines), onSelect: run(() => joinLinesCommand(view, joinLines)) },
          { label: 'Move current line up', shortcut: keyLabel(KEYS.moveLineUp), onSelect: command(moveLineUp) },
          { label: 'Move current line down', shortcut: keyLabel(KEYS.moveLineDown), onSelect: command(moveLineDown) },
          { label: 'Delete current line', shortcut: keyLabel(KEYS.deleteLine), onSelect: command(deleteLine) },
          { label: 'Remove empty lines', onSelect: lines((text) => removeEmptyLines(text)) },
          { label: 'Remove empty lines (containing blank characters)', onSelect: lines((text) => removeEmptyLines(text, true)) },
          { label: 'Insert blank line above current', shortcut: keyLabel(KEYS.blankLineAbove), onSelect: run(() => insertBlankLine(view, true)) },
          { label: 'Insert blank line below current', shortcut: keyLabel(KEYS.blankLineBelow), onSelect: run(() => insertBlankLine(view, false)) },
          { type: 'separator' },
          { label: 'Reverse line order', onSelect: lines(reverseLines) },
          { label: 'Randomize line order', onSelect: lines((text) => shuffleLines(text)) },
          { type: 'separator' },
          ...SORTS.map(([mode, label]) => ({ label, onSelect: lines((text) => sortLines(text, mode)), testId: `menu-sort-${mode}` })),
        ],
      },
      {
        label: 'Comment/uncomment',
        icon: icon(MessageSquareCode),
        disabled: !canEdit,
        submenu: [
          { label: 'Toggle single line comment', shortcut: keyLabel(KEYS.toggleComment), onSelect: comment(toggleComment, 'any') },
          { label: 'Single line comment', onSelect: comment(lineComment, 'line') },
          { label: 'Single line uncomment', onSelect: comment(lineUncomment, 'line') },
          { label: 'Toggle block comment', shortcut: keyLabel(KEYS.toggleBlockComment), onSelect: comment(toggleBlockComment, 'block') },
          { label: 'Block comment', onSelect: comment(blockComment, 'block') },
          { label: 'Block uncomment', onSelect: comment(blockUncomment, 'block') },
        ],
      },
      {
        label: 'Blank operations',
        icon: icon(Space),
        disabled: !canEdit,
        submenu: [
          { label: 'Trim trailing space', onSelect: lines(trimTrailing), testId: 'menu-trim-trailing' },
          { label: 'Trim leading space', onSelect: lines(trimLeading) },
          { label: 'Trim leading and trailing space', onSelect: lines(trimBoth) },
          { label: 'EOL to space', onSelect: lines((text) => [text.join(' ')]) },
          { label: 'Remove unnecessary blank and EOL', onSelect: lines((text) => [trimBoth(text).filter(Boolean).join(' ')]) },
          { type: 'separator' },
          { label: 'TAB to space', onSelect: lines((text) => text.map((line) => tabsToSpaces(line, file.tabSize))) },
          { label: 'Leading space to TAB', onSelect: lines((text) => text.map((line) => leadingSpacesToTabs(line, file.tabSize))) },
        ],
      },
      {
        label: 'EOL conversion',
        disabled: !canEdit,
        submenu: EOLS.map((eol) => ({ label: EOL_LABELS[eol], checked: file.eol === eol, onSelect: run(() => ctx.setFileSettings({ eol })) })),
      },
      { type: 'separator' },
      {
        label: 'Column editor…',
        icon: icon(Columns3),
        shortcut: keyLabel(KEYS.columnEditor),
        disabled: !canEdit,
        onSelect: () => ctx.openDialog('columnEditor'),
        testId: 'menu-column-editor',
      },
    ];
  };

  const searchMenu = (): MenuEntry[] => {
    const canEdit = editable();
    const marked = bookmarkedLines(view.state).length;
    const selectFind = (forward: boolean) =>
      run(() => selectAndFind(view, forward, getSearchQuery(view.state)) || ctx.notify('Put the cursor on a word or select some text first.'));
    return [
      { label: 'Find…', icon: icon(Search), shortcut: keyLabel(KEYS.find), onSelect: () => ctx.openFind(false) },
      { label: 'Replace…', icon: icon(Replace), shortcut: keyLabel(KEYS.replace), disabled: !canEdit, onSelect: () => ctx.openFind(true), testId: 'menu-replace' },
      { label: 'Find next', shortcut: keyLabel(KEYS.findNext), onSelect: command(findNext) },
      { label: 'Find previous', shortcut: keyLabel(KEYS.findPrevious), onSelect: command(findPrevious) },
      { label: 'Select and find next', shortcut: keyLabel(KEYS.selectFindNext), onSelect: selectFind(true) },
      { label: 'Select and find previous', shortcut: keyLabel(KEYS.selectFindPrevious), onSelect: selectFind(false) },
      { label: 'Add next occurrence to selection', shortcut: keyLabel(KEYS.selectNextOccurrence), onSelect: command(selectNextOccurrence) },
      { label: 'Select all occurrences', onSelect: command(selectSelectionMatches, 'Select some text first.') },
      { type: 'separator' },
      { label: 'Go to line…', shortcut: keyLabel(KEYS.goToLine), onSelect: () => ctx.openDialog('goToLine'), testId: 'menu-go-to-line' },
      { label: 'Go to matching bracket', shortcut: keyLabel(KEYS.matchingBracket), onSelect: command(cursorMatchingBracket, 'There is no bracket next to the cursor.') },
      {
        label: 'Select all between matching brackets',
        shortcut: keyLabel(KEYS.selectToBracket),
        onSelect: command(selectMatchingBracket, 'There is no bracket next to the cursor.'),
      },
      { type: 'separator' },
      {
        label: 'Bookmark',
        icon: icon(Bookmark),
        testId: 'menu-bookmarks',
        submenu: [
          { label: 'Toggle bookmark', shortcut: keyLabel(KEYS.toggleBookmark), onSelect: command(toggleBookmark) },
          { label: 'Next bookmark', shortcut: keyLabel(KEYS.nextBookmark), disabled: !marked, onSelect: command(nextBookmark) },
          { label: 'Previous bookmark', shortcut: keyLabel(KEYS.previousBookmark), disabled: !marked, onSelect: command(previousBookmark) },
          { label: 'Clear all bookmarks', disabled: !marked, onSelect: command(clearBookmarks) },
          { label: 'Inverse bookmarks', onSelect: command(inverseBookmarks) },
          { type: 'separator' },
          {
            label: 'Copy bookmarked lines',
            disabled: !marked,
            onSelect: () => ctx.copyText(bookmarkedText(view.state), `Copied ${plural(marked, 'bookmarked line')}`),
          },
          { label: 'Remove bookmarked lines', disabled: !marked || !canEdit, onSelect: run(() => removeBookmarkedLines(view)) },
          { label: 'Remove unmarked lines', disabled: !marked || !canEdit, onSelect: run(() => removeUnmarkedLines(view)) },
        ],
      },
    ];
  };

  const viewMenu = (): MenuEntry[] => {
    const allCharacters = settings.whitespace && settings.eolMarkers;
    return [
      { label: 'Word wrap', icon: icon(TextWrap), shortcut: keyLabel(KEYS.wrap), checked: settings.wrap, onSelect: toggle('wrap'), testId: 'menu-wrap' },
      {
        label: 'Show symbol',
        icon: icon(Pilcrow),
        submenu: [
          { label: 'Show white space and TAB', checked: settings.whitespace, onSelect: toggle('whitespace') },
          { label: 'Show end of line', checked: settings.eolMarkers, onSelect: toggle('eolMarkers') },
          {
            label: 'Show all characters',
            checked: allCharacters,
            onSelect: run(() => ctx.updateSettings({ whitespace: !allCharacters, eolMarkers: !allCharacters })),
          },
          { type: 'separator' },
          { label: 'Show indent guide', checked: settings.indentGuides, onSelect: toggle('indentGuides') },
        ],
      },
      { label: 'Line numbers', icon: icon(ListOrdered), checked: settings.lineNumbers, onSelect: toggle('lineNumbers') },
      { label: 'Folding margin', checked: settings.folding, onSelect: toggle('folding') },
      { label: 'Highlight current line', checked: settings.activeLine, onSelect: toggle('activeLine') },
      { label: 'Document map', icon: icon(MapIcon), checked: settings.minimap, onSelect: toggle('minimap'), testId: 'menu-minimap' },
      { type: 'separator' },
      { label: 'Fold all', shortcut: keyLabel(KEYS.foldAll), onSelect: command(foldAll) },
      { label: 'Unfold all', shortcut: keyLabel(KEYS.unfoldAll), onSelect: command(unfoldAll) },
      { label: 'Fold current level', shortcut: keyLabel(KEYS.fold), onSelect: command(foldCode) },
      { label: 'Unfold current level', shortcut: keyLabel(KEYS.unfold), onSelect: command(unfoldCode) },
      { type: 'separator' },
      {
        label: 'Zoom',
        icon: icon(ZoomIn),
        submenu: [
          { label: 'Zoom in', icon: icon(ZoomIn), shortcut: keyLabel(KEYS.zoomIn), onSelect: run(() => ctx.updateSettings({ zoom: stepZoom(settings.zoom, 1) })) },
          { label: 'Zoom out', icon: icon(ZoomOut), shortcut: keyLabel(KEYS.zoomOut), onSelect: run(() => ctx.updateSettings({ zoom: stepZoom(settings.zoom, -1) })) },
          { label: 'Restore default zoom', shortcut: keyLabel(KEYS.zoomReset), onSelect: run(() => ctx.updateSettings({ zoom: 100 })) },
          { type: 'separator' },
          ...ZOOM_STEPS.map((zoom) => ({ label: `${zoom}%`, checked: settings.zoom === zoom, onSelect: run(() => ctx.updateSettings({ zoom })) })),
        ],
      },
      {
        label: 'Theme',
        icon: icon(SunMoon),
        submenu: THEMES.map(([theme, label]) => ({ label, checked: ctx.theme === theme, onSelect: run(() => ctx.setTheme(theme)) })),
      },
      {
        label: 'Full screen',
        icon: icon(Expand),
        checked: !!document.fullscreenElement,
        onSelect: () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => ctx.notify('Full screen is not available.'));
          view.focus();
        },
      },
      { type: 'separator' },
      { label: 'Summary…', icon: icon(Info), onSelect: () => ctx.openDialog('summary'), testId: 'menu-summary' },
    ];
  };

  const encodingMenu = (): MenuEntry[] => {
    const canEdit = editable();
    return [
      { type: 'label', label: 'Used when the file is downloaded' },
      ...(Object.keys(ENCODING_LABELS) as TextEncodingName[]).map((encoding) => ({
        label: `Encode in ${ENCODING_LABELS[encoding]}`,
        checked: file.encoding === encoding,
        disabled: !canEdit,
        onSelect: run(() => ctx.setFileSettings({ encoding })),
      })),
    ];
  };

  const languageMenu = (): MenuEntry[] => [
    {
      label: `Auto-detect (${ctx.detectedLanguage ?? PLAIN_TEXT})`,
      checked: ctx.languageSetting === null,
      onSelect: run(() => ctx.setLanguage(null)),
    },
    { label: PLAIN_TEXT, checked: ctx.languageSetting === PLAIN_TEXT, onSelect: run(() => ctx.setLanguage(PLAIN_TEXT)) },
    { type: 'separator' },
    ...languageGroups().map(([letter, languages]) => ({
      label: letter,
      submenu: languages.map((language) => ({
        label: language.name,
        checked: ctx.languageSetting === language.name,
        onSelect: run(() => ctx.setLanguage(language.name)),
      })),
    })),
    { type: 'separator' },
    { label: 'Choose language…', onSelect: () => ctx.openDialog('language'), testId: 'menu-choose-language' },
  ];

  const settingsMenu = (): MenuEntry[] => {
    const canEdit = editable();
    return [
      {
        label: 'Indentation',
        icon: icon(ListIndentIncrease),
        disabled: !canEdit,
        submenu: [
          { type: 'label', label: 'Indent using' },
          { label: 'Spaces', checked: !file.useTabs, onSelect: run(() => ctx.setFileSettings({ useTabs: false })) },
          { label: 'Tabs', checked: file.useTabs, onSelect: run(() => ctx.setFileSettings({ useTabs: true })) },
          { type: 'separator' },
          { type: 'label', label: file.useTabs ? 'Tab size' : 'Indent size' },
          ...TAB_SIZES.map((tabSize) => ({ label: String(tabSize), checked: file.tabSize === tabSize, onSelect: run(() => ctx.setFileSettings({ tabSize })) })),
          { type: 'separator' },
          { label: 'Detect from content', onSelect: run(ctx.detectIndentation) },
        ],
      },
      { label: 'Auto-close brackets and quotes', checked: settings.closeBrackets, onSelect: toggle('closeBrackets') },
      { label: 'Auto-completion', checked: settings.autocomplete, onSelect: toggle('autocomplete') },
    ];
  };

  const toolsMenu = (): MenuEntry[] => {
    const canEdit = editable();
    const indent = file.useTabs ? '\t' : file.tabSize;
    return [
      {
        label: 'Hash',
        icon: icon(Hash),
        submenu: HASH_ALGORITHMS.map((algorithm) => ({ label: `${algorithm}…`, onSelect: () => ctx.openHash(algorithm), testId: `menu-hash-${algorithm}` })),
      },
      {
        label: 'Encode / decode',
        icon: icon(Binary),
        disabled: !canEdit,
        submenu: [
          { label: 'Base64 encode', onSelect: transform(base64Encode), testId: 'menu-base64-encode' },
          { label: 'Base64 decode', onSelect: transform(base64Decode), testId: 'menu-base64-decode' },
          { type: 'separator' },
          { label: 'URL encode', onSelect: transform(urlEncode) },
          { label: 'URL decode', onSelect: transform(urlDecode) },
          { type: 'separator' },
          { label: 'Escape HTML', onSelect: transform(escapeHtmlText) },
          { label: 'Unescape HTML', onSelect: transform(unescapeHtmlText) },
        ],
      },
      {
        label: 'JSON',
        icon: icon(Braces),
        disabled: !canEdit,
        submenu: [
          { label: 'Format JSON', onSelect: transform(keepFinalNewline((text) => formatJson(text, indent))), testId: 'menu-format-json' },
          { label: 'Minify JSON', onSelect: transform(keepFinalNewline(minifyJson)) },
        ],
      },
      { type: 'separator' },
      { label: 'Compare…', icon: icon(GitCompareArrows), onSelect: () => ctx.openDialog('compare'), testId: 'menu-compare' },
    ];
  };

  const macroMenu = (): MenuEntry[] => {
    const canEdit = editable();
    const canPlay = canEdit && !ctx.recording && ctx.macro.length > 0;
    return [
      {
        label: ctx.recording ? 'Stop recording' : 'Start recording',
        icon: icon(ctx.recording ? Square : Circle),
        shortcut: keyLabel(KEYS.record),
        disabled: !canEdit && !ctx.recording,
        onSelect: run(ctx.toggleRecording),
        testId: 'menu-macro-record',
      },
      { label: 'Playback', icon: icon(Play), shortcut: keyLabel(KEYS.playback), disabled: !canPlay, onSelect: run(ctx.playMacro), testId: 'menu-macro-play' },
      { label: 'Run a macro multiple times…', icon: icon(Repeat), disabled: !canPlay, onSelect: () => ctx.openDialog('runMacro') },
      { type: 'separator' },
      { type: 'label', label: ctx.macro.length ? `Recorded macro: ${describeMacro(ctx.macro)}` : 'No macro recorded yet' },
    ];
  };

  const helpMenu = (): MenuEntry[] => [
    { label: 'Keyboard shortcuts', icon: icon(Keyboard), onSelect: () => ctx.openDialog('shortcuts') },
    { type: 'label', label: `Tip: hold ${isMac ? '⌥ Option' : 'Alt'} and drag to select a rectangle of text.` },
    { type: 'label', label: `Tip: ${isMac ? '⌘' : 'Ctrl'}+click adds another cursor.` },
  ];

  const builders = [fileMenu, editMenu, searchMenu, viewMenu, encodingMenu, languageMenu, settingsMenu, toolsMenu, macroMenu, helpMenu];
  return MENU_LABELS.map((label, index) => ({ label, items: builders[index]! }));
}

/** The toolbar below the menus, like Notepad++'s. */
export function CodeToolbar({ ctx }: { ctx: CodeMenuContext }) {
  const { view, settings } = ctx;
  const { canUndo, canRedo } = useUndoState(ctx.undoManager);
  // The toolbar is shown once the file has loaded, when the editor is editable exactly when the file is.
  const editable = ctx.canEditFile;
  const allCharacters = settings.whitespace && settings.eolMarkers;
  const focus = (action: () => unknown) => () => {
    action();
    view.focus();
  };
  const size = 18;
  return (
    <div className="app-toolbar code-toolbar no-print" role="toolbar" aria-label="Code editor toolbar" data-testid="code-toolbar">
      <ToolButton label="New file" icon={<FilePlus size={size} />} onClick={ctx.newFile} />
      <ToolButton label="Open file" keys={KEYS.open} icon={<FolderOpen size={size} />} onClick={ctx.openFile} />
      <ToolButton label="Download" icon={<Download size={size} />} onClick={ctx.download} testId="tool-download" />
      <ToolButton label="Print" keys={KEYS.print} icon={<Printer size={size} />} onClick={ctx.print} />
      <ToolDivider />
      <ToolButton
        label="Cut"
        keys="Mod-x"
        icon={<Scissors size={size} />}
        disabled={!editable}
        onClick={() => clipboardCommand(view, 'cut') || ctx.notify(`Use ${shortcut('Mod-x')} to cut.`)}
      />
      <ToolButton label="Copy" keys="Mod-c" icon={<Copy size={size} />} onClick={() => clipboardCommand(view, 'copy') || ctx.notify(`Use ${shortcut('Mod-c')} to copy.`)} />
      <ToolButton
        label="Paste"
        keys="Mod-v"
        icon={<ClipboardPaste size={size} />}
        disabled={!editable}
        onClick={() =>
          void pasteFromClipboard(view).then((ok) => ok || ctx.notify(`Your browser blocked access to the clipboard. Use ${shortcut('Mod-v')} to paste.`))
        }
      />
      <ToolDivider />
      <ToolButton label="Undo" keys={KEYS.undo} icon={<Undo2 size={size} />} disabled={!editable || !canUndo} onClick={focus(() => ctx.undoManager.undo())} testId="tool-undo" />
      <ToolButton label="Redo" keys={KEYS.redo} icon={<Redo2 size={size} />} disabled={!editable || !canRedo} onClick={focus(() => ctx.undoManager.redo())} testId="tool-redo" />
      <ToolDivider />
      <ToolButton label="Find" keys={KEYS.find} icon={<Search size={size} />} onClick={() => ctx.openFind(false)} testId="tool-find" />
      <ToolButton label="Replace" keys={KEYS.replace} icon={<Replace size={size} />} disabled={!editable} onClick={() => ctx.openFind(true)} testId="tool-replace" />
      <ToolDivider />
      <ToolButton
        label="Zoom in"
        keys={KEYS.zoomIn}
        icon={<ZoomIn size={size} />}
        disabled={settings.zoom === ZOOM_STEPS.at(-1)}
        onClick={focus(() => ctx.updateSettings({ zoom: stepZoom(settings.zoom, 1) }))}
      />
      <ToolButton
        label="Zoom out"
        keys={KEYS.zoomOut}
        icon={<ZoomOut size={size} />}
        disabled={settings.zoom === ZOOM_STEPS[0]}
        onClick={focus(() => ctx.updateSettings({ zoom: stepZoom(settings.zoom, -1) }))}
      />
      <ToolDivider />
      <ToolButton
        label="Word wrap"
        keys={KEYS.wrap}
        icon={<TextWrap size={size} />}
        active={settings.wrap}
        onClick={focus(() => ctx.updateSettings({ wrap: !settings.wrap }))}
        testId="tool-wrap"
      />
      <ToolButton
        label="Show all characters"
        icon={<Pilcrow size={size} />}
        active={allCharacters}
        onClick={focus(() => ctx.updateSettings({ whitespace: !allCharacters, eolMarkers: !allCharacters }))}
        testId="tool-all-characters"
      />
      <ToolButton
        label="Show indent guide"
        icon={<ListIndentIncrease size={size} />}
        active={settings.indentGuides}
        onClick={focus(() => ctx.updateSettings({ indentGuides: !settings.indentGuides }))}
      />
      <ToolButton
        label="Document map"
        icon={<MapIcon size={size} />}
        active={settings.minimap}
        onClick={focus(() => ctx.updateSettings({ minimap: !settings.minimap }))}
        testId="tool-minimap"
      />
      <ToolDivider />
      <ToolButton
        label={ctx.recording ? 'Stop recording' : 'Start recording'}
        keys={KEYS.record}
        icon={ctx.recording ? <Square size={size} /> : <Circle size={size} />}
        active={ctx.recording}
        disabled={!editable && !ctx.recording}
        onClick={focus(ctx.toggleRecording)}
        testId="tool-record"
      />
      <ToolButton
        label="Playback"
        keys={KEYS.playback}
        icon={<Play size={size} />}
        disabled={!editable || ctx.recording || !ctx.macro.length}
        onClick={focus(ctx.playMacro)}
        testId="tool-play"
      />
    </div>
  );
}
