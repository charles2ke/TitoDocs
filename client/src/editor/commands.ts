import type { Content, Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { yUndoPluginKey } from '@tiptap/y-tiptap';

export const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

/** Fallbacks for fonts that are often missing (e.g. Microsoft fonts on Linux): metric-compatible ones first. */
const FONT_FALLBACKS: Record<string, string> = {
  Arial: 'Helvetica, "Liberation Sans", sans-serif',
  Calibri: 'Carlito, sans-serif',
  Cambria: 'Caladea, serif',
  'Comic Sans MS': '"Comic Neue", cursive',
  'Courier New': '"Liberation Mono", Courier, monospace',
  Georgia: 'serif',
  Impact: 'sans-serif',
  Tahoma: 'Verdana, sans-serif',
  'Times New Roman': '"Liberation Serif", Times, serif',
  'Trebuchet MS': 'sans-serif',
  Verdana: 'sans-serif',
};

/** The CSS `font-family` value used for a font from the list. */
export const fontStack = (name: string): string => {
  const family = /\s/.test(name) ? `"${name}"` : name;
  return FONT_FALLBACKS[name] ? `${family}, ${FONT_FALLBACKS[name]}` : family;
};

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

/** The first family of a CSS `font-family` value, without quotes. */
export const primaryFont = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.split(',')[0]!.trim().replace(/^["']|["']$/g, '') : null;

/** A CSS font size in points (pixels are converted), or null if it cannot be read. */
export function fontSizeInPoints(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^([\d.]+)\s*(pt|px)?$/.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  return Math.round((match[2] === 'px' ? size * 0.75 : size) * 10) / 10;
}

/** The next preset size above or below `size` (Google Docs' Ctrl+Shift+. and Ctrl+Shift+,). */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZES.find((preset) => preset > size) ?? Math.min(MAX_FONT_SIZE, size + 10);
  return [...FONT_SIZES].reverse().find((preset) => preset < size) ?? Math.max(MIN_FONT_SIZE, size - 1);
}

export type CaseMode = 'lower' | 'upper' | 'title';

const WORD_CHAR = /[\p{L}\p{N}'’]/u;

/** Changes the capitalization of the selected text, keeping its formatting. */
export function changeCase(editor: Editor, mode: CaseMode): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty || !editor.isEditable) return false;
  const segments: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  // For title case: the character before the current one (a space at the start of a paragraph).
  let previous = state.doc.textBetween(Math.max(0, from - 1), from, ' ', ' ') || ' ';
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && pos + 1 >= from) previous = ' ';
    if (node.isInline && !node.isText) previous = ' ';
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const original = node.text!.slice(start - pos, end - pos);
    let changed = '';
    for (const char of original) {
      if (mode === 'upper') changed += char.toLocaleUpperCase();
      else if (mode === 'lower') changed += char.toLocaleLowerCase();
      else changed += WORD_CHAR.test(previous) ? char.toLocaleLowerCase() : char.toLocaleUpperCase();
      previous = char;
    }
    if (changed !== original) segments.push({ from: start, to: end, text: changed, marks: node.marks });
    return false;
  });
  if (!segments.length) return true;
  const tr = state.tr;
  // Work backwards so that earlier positions stay valid even if a replacement changes length (ß → SS).
  for (const segment of segments.reverse()) {
    tr.replaceWith(segment.from, segment.to, state.schema.text(segment.text, segment.marks));
  }
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to)));
  editor.view.dispatch(tr);
  return true;
}

const isPaintable = (mark: Mark): boolean => mark.type.name !== 'link';

/** The text formatting at the start of the selection (for the format painter). */
export function captureMarks(editor: Editor): readonly Mark[] {
  const { state } = editor;
  const { $from, empty, from } = state.selection;
  const node = empty ? null : state.doc.nodeAt(from);
  const marks = node?.isText ? node.marks : (state.storedMarks ?? $from.marks());
  return marks.filter(isPaintable);
}

/** Replaces the formatting of the selected text with `marks` (links are kept). */
export function applyMarks(editor: Editor, marks: readonly Mark[]): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty || !editor.isEditable) return false;
  const tr = state.tr;
  for (const type of Object.values(state.schema.marks)) {
    if (type.name !== 'link') tr.removeMark(from, to, type);
  }
  for (const mark of marks) tr.addMark(from, to, mark);
  editor.view.dispatch(tr);
  return true;
}

/** Removes text formatting (bold, colours, fonts, ...) from the selection, keeping links. */
export function clearFormatting(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { state } = editor;
  if (state.selection.empty) {
    editor.view.dispatch(state.tr.setStoredMarks(state.selection.$from.marks().filter((mark) => !isPaintable(mark))));
    return true;
  }
  return applyMarks(editor, []);
}

/** Pastes from the system clipboard (Edit ▸ Paste); browsers may refuse without a keyboard shortcut. */
export async function pasteFromClipboard(editor: Editor, plainText = false): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    if (!plainText && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          editor.commands.focus();
          return editor.view.pasteHTML(html);
        }
      }
    }
    const text = await navigator.clipboard.readText();
    editor.commands.focus();
    return editor.view.pasteText(text);
  } catch {
    return false;
  }
}

/** Cut or copy through the browser (only works in response to a user action). */
export function clipboardCommand(editor: Editor, command: 'cut' | 'copy'): boolean {
  editor.commands.focus();
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

/**
 * Fills a new collaborative document (template or import) without making it undoable.
 * `addToHistory: false` alone is not enough: plugins such as TrailingNode append transactions without
 * that flag, and y-tiptap then records the whole change, so the shared undo stack is cleared as well.
 */
export function applyInitialContent(editor: Editor, content: Content): void {
  editor.chain().setMeta('addToHistory', false).setContent(content).run();
  yUndoPluginKey.getState(editor.state)?.undoManager.clear();
}
