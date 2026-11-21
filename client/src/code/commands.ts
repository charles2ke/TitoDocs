// Editing commands behind the code editor's menus (Notepad++'s Edit and Search menus).
import { EditorSelection, countColumn, findColumn, type EditorState } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';
import { getIndentUnit, indentUnit } from '@codemirror/language';
import { indentMore } from '@codemirror/commands';
import { findNext, findPrevious, SearchQuery, setSearchQuery } from '@codemirror/search';
import { convertCase, minimalChange, type CaseMode } from './textOps';

interface LineSpan {
  from: number;
  to: number;
  /** No text is selected, so the command works on the whole document. */
  whole: boolean;
}

/** The lines a line operation works on: the selected lines, or the whole document when nothing is selected. */
function selectedLines(state: EditorState): LineSpan {
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (!ranges.length) return { from: 0, to: state.doc.length, whole: true };
  const start = Math.min(...ranges.map((range) => range.from));
  let end = Math.max(...ranges.map((range) => range.to));
  // Whole lines selected with the mouse end at the start of the next line, which isn't part of the selection.
  if (end > start && state.doc.lineAt(end).from === end) end -= 1;
  return { from: state.doc.lineAt(start).from, to: state.doc.lineAt(end).to, whole: false };
}

function replaceLines(view: EditorView, span: LineSpan, transform: (lines: string[]) => string[]): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const before = state.sliceDoc(span.from, span.to);
  const lines = before.split('\n');
  // The final line break stays at the end (sorting would otherwise move the empty last line to the top).
  const final = lines.length > 1 && lines.at(-1) === '' ? lines.pop() : undefined;
  const after = [...transform(lines), ...(final === undefined ? [] : [final])].join('\n');
  const change = minimalChange(before, after);
  if (!change) return true;
  view.dispatch({
    changes: { from: span.from + change.from, to: span.from + change.to, insert: change.insert },
    selection: span.whole ? undefined : EditorSelection.range(span.from, span.from + after.length),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

/** Applies a line operation (sort, remove duplicates, trim, ...) to the selected lines or the whole document. */
export const transformLines = (view: EditorView, transform: (lines: string[]) => string[]): boolean =>
  replaceLines(view, selectedLines(view.state), transform);

/** Joins the selected lines, or the current line with the next one. */
export function joinLinesCommand(view: EditorView, join: (lines: string[]) => string[]): boolean {
  const { state } = view;
  let span = selectedLines(state);
  if (span.whole || state.doc.lineAt(span.from).number === state.doc.lineAt(span.to).number) {
    const line = state.doc.lineAt(state.selection.main.head);
    if (line.number === state.doc.lines) return true;
    span = { from: line.from, to: state.doc.line(line.number + 1).to, whole: false };
  }
  return replaceLines(view, span, join);
}

/** Converts the case of the selections (or of the word at each cursor). */
export function changeCase(view: EditorView, mode: CaseMode): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const random = mode === 'random' ? Math.random : undefined;
  const transaction = state.changeByRange((range) => {
    const word = range.empty ? state.wordAt(range.head) : range;
    if (!word || word.empty) return { range };
    const insert = convertCase(state.sliceDoc(word.from, word.to), mode, random);
    if (range.empty) return { changes: { from: word.from, to: word.to, insert }, range: EditorSelection.cursor(Math.min(range.head, word.from + insert.length)) };
    const anchor = range.anchor === range.from ? word.from : word.from + insert.length;
    const head = range.anchor === range.from ? word.from + insert.length : word.from;
    return { changes: { from: word.from, to: word.to, insert }, range: EditorSelection.range(anchor, head) };
  });
  view.dispatch(transaction, { userEvent: 'input', scrollIntoView: true });
  return true;
}

/**
 * Replaces each selection with `transform(selection)`, or the whole document when nothing is selected
 * (encoders and the JSON formatter). Errors thrown by `transform` leave the document unchanged.
 */
export function transformSelections(view: EditorView, transform: (text: string) => string): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.every((range) => range.empty)) {
    const before = state.doc.toString();
    const change = minimalChange(before, transform(before));
    if (change) view.dispatch({ changes: change, userEvent: 'input', scrollIntoView: true });
    return true;
  }
  const transaction = state.changeByRange((range) => {
    if (range.empty) return { range };
    const insert = transform(state.sliceDoc(range.from, range.to));
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from, range.from + insert.length) };
  });
  view.dispatch(transaction, { userEvent: 'input', scrollIntoView: true });
  return true;
}

/** The selected text, or the whole document when nothing is selected. */
export function selectionOrDocument(state: EditorState): { text: string; selection: boolean } {
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (!ranges.length) return { text: state.doc.toString(), selection: false };
  return { text: ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak), selection: true };
}

/** Tab inserts indentation up to the next tab stop (spaces or a tab), or indents the selected lines. */
export const insertIndent: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => !range.empty)) return indentMore(view);
  const unit = getIndentUnit(state);
  const useTabs = state.facet(indentUnit).startsWith('\t');
  const transaction = state.changeByRange((range) => {
    let insert = '\t';
    if (!useTabs) {
      const line = state.doc.lineAt(range.head);
      const column = countColumn(line.text, state.tabSize, range.head - line.from);
      insert = ' '.repeat(unit - (column % unit));
    }
    return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
  });
  view.dispatch(transaction, { userEvent: 'input.indent', scrollIntoView: true });
  return true;
};

export function insertBlankLine(view: EditorView, above: boolean): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  const position = above ? line.from : line.to;
  view.dispatch({
    changes: { from: position, insert: state.lineBreak },
    selection: EditorSelection.cursor(above ? line.from : line.to + 1),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

export function insertText(view: EditorView, text: string): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input', scrollIntoView: true });
  return true;
}

/** Moves the cursor to a line (and optionally a column, both 1-based), centring it on screen. */
export function goToLine(view: EditorView, line: number, column = 1): void {
  const { doc } = view.state;
  const target = doc.line(Math.max(1, Math.min(doc.lines, Math.trunc(line))));
  const position = target.from + Math.max(0, Math.min(target.length, findColumn(target.text, Math.max(0, column - 1), view.state.tabSize)));
  view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  view.focus();
}

// ------------------------------------------------------------------ column editor

interface ColumnTarget {
  from: number;
  /** Spaces added first, for lines shorter than the column. */
  padding: number;
}

/**
 * Where Edit ▸ Column editor inserts text, as in Notepad++: at every cursor of a multiple or rectangular
 * selection; at the selection's column on each line of a multi-line selection; or, otherwise, at the
 * cursor's column on every line from there to the end of the document.
 */
export function columnTargets(state: EditorState): ColumnTarget[] {
  const { ranges, main } = state.selection;
  if (ranges.length > 1) return ranges.map((range) => ({ from: range.from, padding: 0 }));
  const { doc, tabSize } = state;
  const first = doc.lineAt(main.from);
  let last = doc.lineAt(main.to).number;
  if (last > first.number && doc.line(last).from === main.to) last -= 1;
  if (last === first.number) last = doc.lines;
  const column = countColumn(first.text, tabSize, main.from - first.from);
  const targets: ColumnTarget[] = [];
  for (let number = first.number; number <= last; number += 1) {
    const line = doc.line(number);
    const width = countColumn(line.text, tabSize);
    targets.push(width >= column ? { from: line.from + findColumn(line.text, column, tabSize), padding: 0 } : { from: line.to, padding: column - width });
  }
  return targets;
}

/** Inserts one text per column target (see `columnTargets`). */
export function columnInsert(view: EditorView, texts: readonly string[]): boolean {
  if (view.state.readOnly) return false;
  const changes = columnTargets(view.state).map((target, index) => ({ from: target.from, insert: ' '.repeat(target.padding) + (texts[index] ?? '') }));
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true });
  return true;
}

// ------------------------------------------------------------------ search helpers

export interface Match {
  from: number;
  to: number;
}

/** Matches of a search query, up to `limit`. */
export function findMatches(state: EditorState, query: SearchQuery, limit = 10_000): Match[] {
  const matches: Match[] = [];
  if (!query.valid) return matches;
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done && matches.length < limit; next = cursor.next()) matches.push({ from: next.value.from, to: next.value.to });
  return matches;
}

/** Search ▸ Select and find next/previous: searches for the selected text (or the word at the cursor). */
export function selectAndFind(view: EditorView, forward: boolean, current: SearchQuery): boolean {
  const { state } = view;
  let range = state.selection.main;
  if (range.empty) {
    const word = state.wordAt(range.head);
    if (!word) return false;
    range = word;
  }
  const search = state.sliceDoc(range.from, range.to);
  if (!search || search.includes('\n')) return false;
  view.dispatch({
    selection: EditorSelection.range(range.from, range.to),
    effects: setSearchQuery.of(new SearchQuery({ search, caseSensitive: current.caseSensitive, wholeWord: current.wholeWord, literal: true })),
  });
  return forward ? findNext(view) : findPrevious(view);
}

// ------------------------------------------------------------------ clipboard

/**
 * Edit ▸ Cut/Copy: runs the browser's command, which CodeMirror handles (copying the whole line when nothing is
 * selected). Returns false when the browser refuses, so the caller can suggest the keyboard shortcut.
 */
export function clipboardCommand(view: EditorView, command: 'cut' | 'copy'): boolean {
  view.focus();
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

/** Edit ▸ Paste: returns false when the browser blocks reading the clipboard. */
export async function pasteFromClipboard(view: EditorView): Promise<boolean> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return false;
  }
  if (!view.state.readOnly && text) view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
  view.focus();
  return true;
}
