import type { Editor } from '@tiptap/core';
import { fontSizeInPoints, primaryFont, stepFontSize } from '../editor/commands';

export type DocMode = 'editing' | 'viewing';

export const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200];

export const DEFAULT_FONT = 'Arial';

/** Paragraph styles and their default sizes in points (kept in sync with docs.css and the Word export). */
export const PARAGRAPH_STYLES = [
  { label: 'Normal text', level: 0, size: 11 },
  { label: 'Heading 1', level: 1, size: 20 },
  { label: 'Heading 2', level: 2, size: 16 },
  { label: 'Heading 3', level: 3, size: 14 },
  { label: 'Heading 4', level: 4, size: 12 },
  { label: 'Heading 5', level: 5, size: 11 },
  { label: 'Heading 6', level: 6, size: 11 },
] as const;

/**
 * Line spacing options, named like Google Docs and Word. The values are CSS line heights: "single"
 * spacing in Word is about 1.15 times the font size, and the default (1.15 lines) is the stylesheet's 1.3.
 */
export const LINE_SPACINGS: { label: string; value: string | null }[] = [
  { label: 'Single', value: '1.15' },
  { label: '1.15', value: null },
  { label: '1.5', value: '1.7' },
  { label: 'Double', value: '2.3' },
];

export type Alignment = 'left' | 'center' | 'right' | 'justify';

export const ALIGNMENTS: { value: Alignment; label: string; keys: string }[] = [
  { value: 'left', label: 'Left align', keys: 'Mod-Shift-l' },
  { value: 'center', label: 'Center align', keys: 'Mod-Shift-e' },
  { value: 'right', label: 'Right align', keys: 'Mod-Shift-r' },
  { value: 'justify', label: 'Justify', keys: 'Mod-Shift-j' },
];

export interface FormatState {
  editable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 0 for normal text, otherwise the heading level. */
  headingLevel: number;
  styleLabel: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  code: boolean;
  color: string | null;
  highlight: string | null;
  link: boolean;
  align: Alignment;
  lineHeight: string | null;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
}

/** The formatting at the cursor, as shown by the toolbar and menus. */
export function readFormatState(editor: Editor): FormatState {
  const textStyle = editor.getAttributes('textStyle');
  const headingLevel = editor.isActive('heading') ? Number(editor.getAttributes('heading').level) || 0 : 0;
  const style = PARAGRAPH_STYLES.find((entry) => entry.level === headingLevel) ?? PARAGRAPH_STYLES[0];
  const block = editor.getAttributes(headingLevel ? 'heading' : 'paragraph');
  const color = editor.getAttributes('highlight').color;
  return {
    editable: editor.isEditable,
    canUndo: editor.isEditable && editor.can().undo(),
    canRedo: editor.isEditable && editor.can().redo(),
    headingLevel,
    styleLabel: editor.isActive('codeBlock') ? 'Code block' : style.label,
    fontFamily: primaryFont(textStyle.fontFamily) ?? DEFAULT_FONT,
    fontSize: fontSizeInPoints(textStyle.fontSize) ?? style.size,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    superscript: editor.isActive('superscript'),
    subscript: editor.isActive('subscript'),
    code: editor.isActive('code'),
    color: typeof textStyle.color === 'string' && textStyle.color ? textStyle.color : null,
    highlight: editor.isActive('highlight') ? (typeof color === 'string' && color ? color : '#ffff00') : null,
    link: editor.isActive('link'),
    align: (['left', 'center', 'right', 'justify'] as const).find((value) => value === block.textAlign) ?? 'left',
    lineHeight: typeof block.lineHeight === 'string' ? block.lineHeight : null,
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
  };
}

/** Makes the selected text one preset size bigger or smaller. */
export function stepSelectionFontSize(editor: Editor, direction: 1 | -1): boolean {
  if (!editor.isEditable) return false;
  const size = stepFontSize(readFormatState(editor).fontSize, direction);
  return editor.chain().focus().setFontSize(`${size}pt`).run();
}
