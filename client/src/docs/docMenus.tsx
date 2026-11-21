import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code,
  Copy,
  Download,
  Eye,
  FilePlus,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  Italic,
  Keyboard,
  Link,
  ListTree,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Omega,
  Pencil,
  Pilcrow,
  Printer,
  Redo2,
  RemoveFormatting,
  Scissors,
  Search,
  SeparatorHorizontal,
  Settings2,
  SpellCheck,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableOfContents,
  Trash2,
  Underline,
  Undo2,
  ClipboardPaste,
  Calendar,
  Quote,
  ChevronsUpDown,
  Expand,
  Sigma,
  CaseSensitive,
} from 'lucide-react';
import type { MenuBarMenu, MenuEntry } from '../components/Menu';
import { changeCase, clearFormatting, clipboardCommand, pasteFromClipboard } from '../editor/commands';
import { today } from '../editor/slashItems';
import { TablePicker } from '../editor/TablePicker';
import { shortcut } from '../lib/util';
import { ALIGNMENTS, LINE_SPACINGS, PARAGRAPH_STYLES, readFormatState, stepSelectionFontSize, ZOOM_LEVELS, type DocMode } from './formatting';
import { ALIGNMENT_ICONS } from './Toolbar';

export type DownloadFormat = 'docx' | 'pdf' | 'html' | 'md' | 'txt';

export type DocDialog = 'link' | 'pageSetup' | 'wordCount' | 'shortcuts' | 'specialCharacters' | 'imageUrl' | 'altText' | 'versions' | 'nameVersion' | 'trash';

export interface DocMenuContext {
  editor: Editor;
  /** The user may edit the file (role and not in the trash), whatever the current mode. */
  canEditFile: boolean;
  canComment: boolean;
  isOwner: boolean;
  mode: DocMode;
  setMode: (mode: DocMode) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  showOutline: boolean;
  toggleOutline: () => void;
  showComments: boolean;
  toggleComments: () => void;
  showWordCount: boolean;
  toggleWordCount: () => void;
  spellcheck: boolean;
  toggleSpellcheck: () => void;
  openDialog: (dialog: DocDialog) => void;
  openFind: (replace: boolean) => void;
  addComment: () => void;
  uploadImage: () => void;
  print: () => void;
  download: (format: DownloadFormat) => void;
  newDocument: () => void;
  makeCopy: () => void;
  openFile: () => void;
  rename: () => void;
  notify: (message: string) => void;
}

const icon = (Icon: typeof Bold) => <Icon size={16} />;

export function buildDocMenus(ctx: DocMenuContext): MenuBarMenu[] {
  const { editor } = ctx;
  const chain = () => editor.chain().focus();

  const file = (): MenuEntry[] => [
    { label: 'New document', icon: icon(FilePlus), onSelect: ctx.newDocument },
    { label: 'Open file…', icon: icon(FolderOpen), shortcut: shortcut('Mod-o'), onSelect: ctx.openFile },
    { label: 'Make a copy', icon: icon(Copy), onSelect: ctx.makeCopy, testId: 'menu-make-copy' },
    { type: 'separator' },
    {
      label: 'Download',
      icon: icon(Download),
      testId: 'menu-download',
      submenu: [
        { label: 'Microsoft Word (.docx)', onSelect: () => ctx.download('docx'), testId: 'download-docx' },
        { label: 'PDF document (.pdf)', onSelect: () => ctx.download('pdf'), testId: 'download-pdf' },
        { label: 'Web page (.html)', onSelect: () => ctx.download('html'), testId: 'download-html' },
        { label: 'Markdown (.md)', onSelect: () => ctx.download('md'), testId: 'download-md' },
        { label: 'Plain text (.txt)', onSelect: () => ctx.download('txt'), testId: 'download-txt' },
      ],
    },
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
              { label: 'See version history', shortcut: shortcut('Mod-Alt-Shift-h'), onSelect: () => ctx.openDialog('versions'), testId: 'menu-versions' },
            ],
          },
          { label: 'Page setup', icon: icon(Settings2), onSelect: () => ctx.openDialog('pageSetup'), testId: 'menu-page-setup' },
        ] satisfies MenuEntry[])
      : []),
    { type: 'separator' },
    { label: 'Print', icon: icon(Printer), shortcut: shortcut('Mod-p'), onSelect: ctx.print },
  ];

  const edit = (): MenuEntry[] => {
    const editable = editor.isEditable;
    const empty = editor.state.selection.empty;
    return [
      { label: 'Undo', icon: icon(Undo2), shortcut: shortcut('Mod-z'), disabled: !editable || !editor.can().undo(), onSelect: () => chain().undo().run() },
      { label: 'Redo', icon: icon(Redo2), shortcut: shortcut('Mod-Shift-z'), disabled: !editable || !editor.can().redo(), onSelect: () => chain().redo().run() },
      { type: 'separator' },
      {
        label: 'Cut',
        icon: icon(Scissors),
        shortcut: shortcut('Mod-x'),
        disabled: !editable || empty,
        onSelect: () => clipboardCommand(editor, 'cut') || ctx.notify(`Use ${shortcut('Mod-x')} to cut.`),
      },
      {
        label: 'Copy',
        icon: icon(Copy),
        shortcut: shortcut('Mod-c'),
        disabled: empty,
        onSelect: () => clipboardCommand(editor, 'copy') || ctx.notify(`Use ${shortcut('Mod-c')} to copy.`),
      },
      {
        label: 'Paste',
        icon: icon(ClipboardPaste),
        shortcut: shortcut('Mod-v'),
        disabled: !editable,
        onSelect: () =>
          void pasteFromClipboard(editor).then((ok) => ok || ctx.notify(`Your browser blocked access to the clipboard. Use ${shortcut('Mod-v')} to paste.`)),
      },
      {
        label: 'Paste without formatting',
        shortcut: shortcut('Mod-Shift-v'),
        disabled: !editable,
        onSelect: () =>
          void pasteFromClipboard(editor, true).then(
            (ok) => ok || ctx.notify(`Your browser blocked access to the clipboard. Use ${shortcut('Mod-Shift-v')} to paste.`),
          ),
      },
      { type: 'separator' },
      { label: 'Select all', shortcut: shortcut('Mod-a'), onSelect: () => chain().selectAll().run() },
      { label: 'Delete', disabled: !editable || empty, onSelect: () => chain().deleteSelection().run() },
      { type: 'separator' },
      { label: 'Find', icon: icon(Search), shortcut: shortcut('Mod-f'), onSelect: () => ctx.openFind(false) },
      { label: 'Find and replace', shortcut: shortcut('Mod-h'), disabled: !editable, onSelect: () => ctx.openFind(true), testId: 'menu-find-replace' },
    ];
  };

  const view = (): MenuEntry[] => [
    ...(ctx.canEditFile
      ? ([
          {
            label: 'Mode',
            icon: ctx.mode === 'editing' ? icon(Pencil) : icon(Eye),
            submenu: [
              { label: 'Editing', checked: ctx.mode === 'editing', onSelect: () => ctx.setMode('editing') },
              { label: 'Viewing', checked: ctx.mode === 'viewing', onSelect: () => ctx.setMode('viewing') },
            ],
          },
          { type: 'separator' },
        ] satisfies MenuEntry[])
      : []),
    { label: 'Show outline', icon: icon(ListTree), checked: ctx.showOutline, onSelect: ctx.toggleOutline, testId: 'menu-outline' },
    { label: 'Show comments', icon: icon(MessageSquare), checked: ctx.showComments, onSelect: ctx.toggleComments },
    { label: 'Show word count', icon: icon(Sigma), checked: ctx.showWordCount, onSelect: ctx.toggleWordCount },
    {
      label: 'Show non-printing characters',
      icon: icon(Pilcrow),
      shortcut: shortcut('Mod-Shift-p'),
      checked: !!editor.storage.invisibleCharacters?.visibility(),
      onSelect: () => editor.commands.toggleInvisibleCharacters(),
    },
    { type: 'separator' },
    {
      label: 'Zoom',
      submenu: ZOOM_LEVELS.map((level) => ({ label: `${level}%`, checked: ctx.zoom === level, onSelect: () => ctx.setZoom(level) })),
    },
    {
      label: 'Full screen',
      icon: icon(Expand),
      checked: !!document.fullscreenElement,
      onSelect: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => ctx.notify('Full screen is not available.'));
      },
    },
  ];

  const insert = (): MenuEntry[] => {
    const editable = editor.isEditable;
    return [
      {
        label: 'Image',
        icon: icon(ImagePlus),
        disabled: !editable,
        submenu: [
          { label: 'Upload from computer', onSelect: ctx.uploadImage },
          { label: 'By URL…', onSelect: () => ctx.openDialog('imageUrl') },
        ],
      },
      {
        label: 'Table',
        icon: icon(Table),
        disabled: !editable,
        testId: 'menu-insert-table',
        submenu: [
          {
            type: 'custom',
            render: (close) => (
              <TablePicker
                onPick={(rows, cols) => {
                  close();
                  chain().insertTable({ rows, cols, withHeaderRow: false }).run();
                }}
              />
            ),
          },
        ],
      },
      { type: 'separator' },
      { label: 'Link', icon: icon(Link), shortcut: shortcut('Mod-k'), disabled: !editable, onSelect: () => ctx.openDialog('link') },
      { label: 'Comment', icon: icon(MessageSquarePlus), shortcut: shortcut('Mod-Alt-m'), disabled: !ctx.canComment, onSelect: ctx.addComment },
      { type: 'separator' },
      { label: 'Special characters', icon: icon(Omega), disabled: !editable, onSelect: () => ctx.openDialog('specialCharacters') },
      { label: 'Date', icon: icon(Calendar), disabled: !editable, onSelect: () => chain().insertContent(today()).run() },
      { label: 'Horizontal line', icon: icon(Minus), disabled: !editable, onSelect: () => chain().setHorizontalRule().run() },
      {
        label: 'Page break',
        icon: icon(SeparatorHorizontal),
        shortcut: shortcut('Mod-Enter'),
        disabled: !editable,
        onSelect: () => chain().setPageBreak().run(),
        testId: 'menu-page-break',
      },
      { type: 'separator' },
      { label: 'Code block', icon: icon(Code), shortcut: shortcut('Mod-Alt-c'), disabled: !editable, onSelect: () => chain().toggleCodeBlock().run() },
      { label: 'Quote', icon: icon(Quote), shortcut: shortcut('Mod-Shift-b'), disabled: !editable, onSelect: () => chain().toggleBlockquote().run() },
      { label: 'Collapsible section', icon: icon(ChevronsUpDown), disabled: !editable, onSelect: () => chain().setDetails().run() },
      {
        label: 'Table of contents',
        icon: icon(TableOfContents),
        disabled: !editable,
        onSelect: () => chain().insertTableOfContents().run(),
        testId: 'menu-toc',
      },
    ];
  };

  const format = (): MenuEntry[] => {
    const state = readFormatState(editor);
    const editable = state.editable;
    const inTable = editor.isActive('table');
    const table = (label: string, run: () => boolean, enabled = true): MenuEntry => ({
      label,
      disabled: !enabled,
      onSelect: () => void run(),
    });
    return [
      {
        label: 'Text',
        icon: icon(Bold),
        disabled: !editable,
        submenu: [
          { label: 'Bold', icon: icon(Bold), shortcut: shortcut('Mod-b'), checked: state.bold, onSelect: () => chain().toggleBold().run() },
          { label: 'Italic', icon: icon(Italic), shortcut: shortcut('Mod-i'), checked: state.italic, onSelect: () => chain().toggleItalic().run() },
          {
            label: 'Underline',
            icon: icon(Underline),
            shortcut: shortcut('Mod-u'),
            checked: state.underline,
            onSelect: () => chain().toggleUnderline().run(),
          },
          {
            label: 'Strikethrough',
            icon: icon(Strikethrough),
            shortcut: shortcut('Mod-Shift-s'),
            checked: state.strike,
            onSelect: () => chain().toggleStrike().run(),
          },
          {
            label: 'Superscript',
            icon: icon(Superscript),
            shortcut: shortcut('Mod-.'),
            checked: state.superscript,
            onSelect: () => chain().toggleSuperscript().run(),
          },
          {
            label: 'Subscript',
            icon: icon(Subscript),
            shortcut: shortcut('Mod-,'),
            checked: state.subscript,
            onSelect: () => chain().toggleSubscript().run(),
          },
          { label: 'Code', icon: icon(Code), shortcut: shortcut('Mod-e'), checked: state.code, onSelect: () => chain().toggleCode().run() },
          { type: 'separator' },
          {
            label: 'Size',
            submenu: [
              { label: 'Increase font size', shortcut: shortcut('Mod-Shift-.'), onSelect: () => stepSelectionFontSize(editor, 1) },
              { label: 'Decrease font size', shortcut: shortcut('Mod-Shift-,'), onSelect: () => stepSelectionFontSize(editor, -1) },
            ],
          },
          {
            label: 'Capitalization',
            icon: icon(CaseSensitive),
            submenu: [
              { label: 'lowercase', onSelect: () => changeCase(editor, 'lower') },
              { label: 'UPPERCASE', onSelect: () => changeCase(editor, 'upper') },
              { label: 'Title Case', onSelect: () => changeCase(editor, 'title') },
            ],
          },
        ],
      },
      {
        label: 'Paragraph styles',
        icon: icon(FileText),
        disabled: !editable,
        submenu: PARAGRAPH_STYLES.map((style) => ({
          label: style.label,
          shortcut: shortcut(`Mod-Alt-${style.level}`),
          checked: state.headingLevel === style.level && state.styleLabel !== 'Code block',
          onSelect: () => (style.level ? chain().setHeading({ level: style.level }).run() : chain().setParagraph().run()),
        })),
      },
      {
        label: 'Align & indent',
        icon: icon(ALIGNMENT_ICONS[state.align]),
        disabled: !editable,
        submenu: [
          ...ALIGNMENTS.map((alignment) => ({
            label: alignment.label,
            icon: icon(ALIGNMENT_ICONS[alignment.value]),
            shortcut: shortcut(alignment.keys),
            checked: state.align === alignment.value,
            onSelect: () => chain().setTextAlign(alignment.value).run(),
          })),
          { type: 'separator' },
          { label: 'Increase indent', shortcut: shortcut('Mod-]'), onSelect: () => chain().indent().run() },
          { label: 'Decrease indent', shortcut: shortcut('Mod-['), onSelect: () => chain().outdent().run() },
        ],
      },
      {
        label: 'Line spacing',
        disabled: !editable,
        submenu: LINE_SPACINGS.map((spacing) => ({
          label: spacing.label,
          checked: state.lineHeight === spacing.value,
          onSelect: () => chain().setLineHeight(spacing.value).run(),
        })),
      },
      {
        label: 'Bullets & numbering',
        disabled: !editable,
        submenu: [
          { label: 'Bulleted list', shortcut: shortcut('Mod-Shift-8'), checked: state.bulletList, onSelect: () => chain().toggleBulletList().run() },
          { label: 'Numbered list', shortcut: shortcut('Mod-Shift-7'), checked: state.orderedList, onSelect: () => chain().toggleOrderedList().run() },
          { label: 'Checklist', shortcut: shortcut('Mod-Shift-9'), checked: state.taskList, onSelect: () => chain().toggleTaskList().run() },
        ],
      },
      { type: 'separator' },
      {
        label: 'Table',
        icon: icon(Table),
        disabled: !editable || !inTable,
        submenu: [
          table('Insert row above', () => chain().addRowBefore().run()),
          table('Insert row below', () => chain().addRowAfter().run()),
          table('Insert column left', () => chain().addColumnBefore().run()),
          table('Insert column right', () => chain().addColumnAfter().run()),
          { type: 'separator' },
          table('Delete row', () => chain().deleteRow().run()),
          table('Delete column', () => chain().deleteColumn().run()),
          table('Delete table', () => chain().deleteTable().run()),
          { type: 'separator' },
          table('Merge cells', () => chain().mergeCells().run(), editor.can().mergeCells()),
          table('Split cell', () => chain().splitCell().run(), editor.can().splitCell()),
          table('Toggle header row', () => chain().toggleHeaderRow().run()),
          table('Toggle header column', () => chain().toggleHeaderColumn().run()),
        ],
      },
      {
        label: 'Image alt text…',
        icon: icon(ImagePlus),
        disabled: !editable || !editor.isActive('image'),
        onSelect: () => ctx.openDialog('altText'),
      },
      { type: 'separator' },
      {
        label: 'Clear formatting',
        icon: icon(RemoveFormatting),
        shortcut: shortcut('Mod-\\'),
        disabled: !editable,
        onSelect: () => {
          editor.commands.focus();
          clearFormatting(editor);
        },
      },
    ];
  };

  const tools = (): MenuEntry[] => [
    { label: 'Word count', icon: icon(Sigma), shortcut: shortcut('Mod-Shift-c'), onSelect: () => ctx.openDialog('wordCount'), testId: 'menu-word-count' },
    { label: 'Spell check', icon: icon(SpellCheck), checked: ctx.spellcheck, onSelect: ctx.toggleSpellcheck },
  ];

  const help = (): MenuEntry[] => [
    { label: 'Keyboard shortcuts', icon: icon(Keyboard), shortcut: shortcut('Mod-/'), onSelect: () => ctx.openDialog('shortcuts') },
    { type: 'label', label: `Tip: type “/” at the start of a line for the commands menu, or “@” to mention someone.` },
  ];

  return [
    { label: 'File', items: file },
    { label: 'Edit', items: edit },
    { label: 'View', items: view },
    { label: 'Insert', items: insert },
    { label: 'Format', items: format },
    { label: 'Tools', items: tools },
    { label: 'Help', items: help },
  ];
}
