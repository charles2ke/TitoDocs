import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchQuery {
  term: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  query: SearchQuery | null;
  matches: SearchMatch[];
  /** Index of the highlighted match, or -1. */
  current: number;
  /** Set when a regular expression is invalid. */
  error: string | null;
  decorations: DecorationSet;
}

type SearchMeta = { query: SearchQuery | null } | { current: number };

export const searchPluginKey = new PluginKey<SearchState>('findReplace');
/** Marks a transaction made by "Replace", so the next match is searched after the replacement. */
const REPLACED_META = 'findReplace:replaced';

const MAX_MATCHES = 5000;
/** Inline leaf nodes (images, mentions, line breaks) occupy one position; this keeps text offsets aligned. */
const LEAF_PLACEHOLDER = '\ufffc';

/** Builds the regular expression for a query, or throws if it is invalid. */
export function buildSearchRegExp(query: SearchQuery, global = true): RegExp {
  let source = query.regex ? query.term : query.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (query.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  return new RegExp(source, `${global ? 'g' : ''}u${query.caseSensitive ? '' : 'i'}`);
}

function findMatches(doc: PMNode, query: SearchQuery): { matches: SearchMatch[]; error: string | null } {
  let regexp: RegExp;
  try {
    regexp = buildSearchRegExp(query);
  } catch (error) {
    return { matches: [], error: (error as Error).message };
  }
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, LEAF_PLACEHOLDER);
    regexp.lastIndex = 0;
    for (let match = regexp.exec(text); match; match = regexp.exec(text)) {
      if (match[0].length === 0) {
        // Skip empty matches (e.g. /a*/) so the loop always advances.
        regexp.lastIndex += 1;
        continue;
      }
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
      if (matches.length >= MAX_MATCHES) break;
    }
    return false;
  });
  return { matches, error: null };
}

function decorate(doc: PMNode, matches: SearchMatch[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, { class: index === current ? 'search-match search-match-current' : 'search-match' }),
    ),
  );
}

const EMPTY: SearchState = { query: null, matches: [], current: -1, error: null, decorations: DecorationSet.empty };

/** First match at or after `pos` (wrapping around). */
const matchIndexFrom = (matches: SearchMatch[], pos: number): number => {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.from >= pos);
  return index === -1 ? 0 : index;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchQuery: (query: SearchQuery | null) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

export const getSearchState = (state: EditorState): SearchState => searchPluginKey.getState(state) ?? EMPTY;

/** The text that replaces a match; regular expressions may refer to groups with $1, $2, … */
function replacementFor(state: SearchState, doc: PMNode, match: SearchMatch, replacement: string): string {
  if (!state.query?.regex) return replacement;
  const text = doc.textBetween(match.from, match.to, undefined, LEAF_PLACEHOLDER);
  return text.replace(buildSearchRegExp(state.query, false), replacement);
}

function replaceRange(tr: Transaction, from: number, to: number, text: string): void {
  if (text) tr.insertText(text, from, to);
  else tr.delete(from, to);
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => EMPTY,
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;
            if (meta && 'query' in meta) {
              if (!meta.query?.term) return { ...EMPTY, query: meta.query };
              const { matches, error } = findMatches(newState.doc, meta.query);
              const current = matchIndexFrom(matches, newState.selection.from);
              return { query: meta.query, matches, error, current, decorations: decorate(newState.doc, matches, current) };
            }
            if (meta && 'current' in meta) {
              return { ...previous, current: meta.current, decorations: decorate(newState.doc, previous.matches, meta.current) };
            }
            if (tr.docChanged && previous.query?.term) {
              const { matches, error } = findMatches(newState.doc, previous.query);
              // Keep roughly the same place in the document after edits.
              const anchor = previous.matches[previous.current];
              let current = -1;
              if (tr.getMeta(REPLACED_META)) current = matchIndexFrom(matches, newState.selection.from);
              else if (anchor) current = matchIndexFrom(matches, tr.mapping.map(anchor.from, -1));
              return { ...previous, matches, error, current, decorations: decorate(newState.doc, matches, current) };
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => searchPluginKey.getState(state)?.decorations,
        },
      }),
    ];
  },

  addCommands() {
    const select =
      (step: 1 | -1) =>
      () =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: unknown }) => {
        const search = getSearchState(state);
        if (!search.matches.length) return false;
        let current: number;
        if (search.current === -1) {
          current = matchIndexFrom(search.matches, state.selection.from);
        } else {
          current = (search.current + step + search.matches.length) % search.matches.length;
        }
        if (dispatch) {
          const match = search.matches[current]!;
          tr.setMeta(searchPluginKey, { current } satisfies SearchMeta);
          tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
        }
        return true;
      };

    return {
      setSearchQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchPluginKey, { query } satisfies SearchMeta);
          return true;
        },
      findNext: select(1),
      findPrevious: select(-1),
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch, editor }) => {
          const search = getSearchState(state);
          const match = search.matches[search.current];
          if (!match || !editor.isEditable) return false;
          if (dispatch) {
            replaceRange(tr, match.from, match.to, replacementFor(search, state.doc, match, replacement));
            // Move on to the following match, like most editors.
            const next = tr.mapping.map(match.to);
            tr.setSelection(TextSelection.create(tr.doc, next)).setMeta(REPLACED_META, true).scrollIntoView();
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch, editor }) => {
          const search = getSearchState(state);
          if (!search.matches.length || !editor.isEditable) return false;
          if (dispatch) {
            // Replace from the end so earlier positions stay valid.
            for (const match of [...search.matches].reverse()) {
              replaceRange(tr, match.from, match.to, replacementFor(search, state.doc, match, replacement));
            }
          }
          return true;
        },
    };
  },
});
