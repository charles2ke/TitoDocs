// Notepad++-style bookmarks: a gutter marker per bookmarked line, kept for the editing session.
import { EditorSelection, RangeSet, StateEffect, StateField, type ChangeSpec, type EditorState, type Text } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, type Command } from '@codemirror/view';

class BookmarkMarker extends GutterMarker {
  override toDOM(): Node {
    const dot = document.createElement('span');
    dot.className = 'cm-bookmark';
    return dot;
  }
}

const marker = new BookmarkMarker();
const lineDecoration = Decoration.line({ class: 'cm-bookmarked-line' });

/** Replaces every bookmark with bookmarks on the lines holding the given positions. */
const setBookmarks = StateEffect.define<readonly number[]>();
const toggleBookmarks = StateEffect.define<readonly number[]>();

function build(positions: Iterable<number>, doc: Text): RangeSet<GutterMarker> {
  const starts = new Set<number>();
  for (const position of positions) starts.add(doc.lineAt(Math.max(0, Math.min(position, doc.length))).from);
  return RangeSet.of([...starts].sort((a, b) => a - b).map((from) => marker.range(from)));
}

function positionsOf(set: RangeSet<GutterMarker>): number[] {
  const positions: number[] = [];
  for (let cursor = set.iter(); cursor.value; cursor.next()) positions.push(cursor.from);
  return positions;
}

export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    // Bookmarks stay at the start of their line, also when lines are joined or split.
    let set = tr.docChanged ? build(positionsOf(value.map(tr.changes)), tr.state.doc) : value;
    for (const effect of tr.effects) {
      if (effect.is(setBookmarks)) {
        set = build(effect.value, tr.state.doc);
      } else if (effect.is(toggleBookmarks)) {
        const current = new Set(positionsOf(set));
        for (const position of new Set(effect.value.map((pos) => tr.state.doc.lineAt(pos).from))) {
          if (current.has(position)) current.delete(position);
          else current.add(position);
        }
        set = build(current, tr.state.doc);
      }
    }
    return set;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (set) => Decoration.set(positionsOf(set).map((from) => lineDecoration.range(from)))),
});

export const bookmarks = [
  bookmarkField,
  gutter({
    class: 'cm-bookmark-gutter',
    markers: (view) => view.state.field(bookmarkField),
    initialSpacer: () => marker,
    domEventHandlers: {
      mousedown(view, line, event) {
        if ((event as MouseEvent).button !== 0) return false;
        view.dispatch({ effects: toggleBookmarks.of([line.from]) });
        return true;
      },
    },
  }),
];

/** Line numbers (1-based) of the bookmarked lines, in order. */
export const bookmarkedLines = (state: EditorState): number[] =>
  positionsOf(state.field(bookmarkField, false) ?? RangeSet.empty).map((from) => state.doc.lineAt(from).number);

export const toggleBookmark: Command = (view) => {
  view.dispatch({ effects: toggleBookmarks.of(view.state.selection.ranges.map((range) => range.head)) });
  return true;
};

/** Bookmarks the lines holding the given positions, keeping the existing bookmarks. */
export function addBookmarks(view: EditorView, positions: readonly number[]): void {
  view.dispatch({ effects: setBookmarks.of([...positionsOf(view.state.field(bookmarkField)), ...positions]) });
}

export const clearBookmarks: Command = (view) => {
  view.dispatch({ effects: setBookmarks.of([]) });
  return true;
};

export const inverseBookmarks: Command = (view) => {
  const { doc } = view.state;
  const marked = new Set(bookmarkedLines(view.state));
  const positions: number[] = [];
  for (let number = 1; number <= doc.lines; number += 1) if (!marked.has(number)) positions.push(doc.line(number).from);
  view.dispatch({ effects: setBookmarks.of(positions) });
  return true;
};

function jumpToBookmark(view: EditorView, forward: boolean): boolean {
  const lines = bookmarkedLines(view.state);
  if (!lines.length) return false;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = forward ? (lines.find((line) => line > current) ?? lines[0]!) : (lines.findLast((line) => line < current) ?? lines.at(-1)!);
  const position = view.state.doc.line(target).from;
  view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  return true;
}

export const nextBookmark: Command = (view) => jumpToBookmark(view, true);
export const previousBookmark: Command = (view) => jumpToBookmark(view, false);

/** The text of the bookmarked lines, one per line. */
export const bookmarkedText = (state: EditorState): string =>
  bookmarkedLines(state)
    .map((number) => state.doc.line(number).text)
    .join('\n');

/** Changes deleting whole lines (with their line breaks), merging runs of adjacent lines. */
function deleteLines(doc: Text, numbers: readonly number[]): ChangeSpec[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const changes: ChangeSpec[] = [];
  for (let index = 0; index < sorted.length; ) {
    const first = sorted[index]!;
    let last = first;
    while (sorted[index + 1] === last + 1) {
      index += 1;
      last += 1;
    }
    index += 1;
    if (last < doc.lines) changes.push({ from: doc.line(first).from, to: doc.line(last + 1).from });
    else if (first > 1) changes.push({ from: doc.line(first - 1).to, to: doc.line(last).to });
    else changes.push({ from: 0, to: doc.length });
  }
  return changes;
}

export function removeBookmarkedLines(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const lines = bookmarkedLines(state);
  if (lines.length) view.dispatch({ changes: deleteLines(state.doc, lines), userEvent: 'delete' });
  return true;
}

export function removeUnmarkedLines(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const marked = new Set(bookmarkedLines(state));
  const unmarked: number[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) if (!marked.has(number)) unmarked.push(number);
  if (unmarked.length) view.dispatch({ changes: deleteLines(state.doc, unmarked), userEvent: 'delete' });
  return true;
}
