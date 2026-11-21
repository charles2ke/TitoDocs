// Search ▸ Find / Replace: a panel docked above the editor, and the "Find all" results below it.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import { ArrowDown, ArrowUp, BookmarkPlus, CaseSensitive, ChevronDown, ChevronRight, ListFilter, TextCursorInput, WholeWord, X } from 'lucide-react';
import { shortcut } from '../lib/util';
import { addBookmarks } from './bookmarks';
import { findMatches, type Match } from './commands';
import { keyLabel, KEYS, useViewState, type ViewStore } from './editorSetup';

/** Matches are counted up to this number. */
const LIMIT = 10_000;

type SearchMode = 'normal' | 'extended' | 'regexp';

const MODES: Record<SearchMode, { literal: boolean; regexp: boolean }> = {
  normal: { literal: true, regexp: false },
  extended: { literal: false, regexp: false },
  regexp: { literal: false, regexp: true },
};

const modeOf = (query: SearchQuery): SearchMode => (query.regexp ? 'regexp' : query.literal ? 'normal' : 'extended');

type QueryFields = Pick<SearchQuery, 'search' | 'replace' | 'caseSensitive' | 'literal' | 'regexp' | 'wholeWord'>;

function updateQuery(view: EditorView, patch: Partial<QueryFields>): void {
  const { search, replace, caseSensitive, literal, regexp, wholeWord } = getSearchQuery(view.state);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, replace, caseSensitive, literal, regexp, wholeWord, ...patch })) });
}

const plural = (count: number, word: string): string => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/** Matches of the search query, computed in the background so typing stays responsive in large files. */
function useMatches(state: EditorState): { query: SearchQuery; matches: Match[] } {
  const deferred = useDeferredValue(state);
  const query = getSearchQuery(deferred);
  // Recomputed when the text or the query changes, not when the cursor moves.
  const matches = useMemo(() => findMatches(deferred, query, LIMIT + 1), [deferred.doc, query]);
  return { query, matches };
}

function matchStatus(state: EditorState, query: SearchQuery, matches: Match[]): string {
  const current = getSearchQuery(state);
  if (current.search && !current.valid) return 'Invalid regular expression';
  if (!query.valid) return '';
  if (!matches.length) return 'No results';
  const total = matches.length > LIMIT ? `${LIMIT.toLocaleString()}+` : matches.length.toLocaleString();
  const { from, to } = state.selection.main;
  const index = matches.findIndex((match) => match.from === from && match.to === to);
  return index >= 0 ? `${(index + 1).toLocaleString()} of ${total}` : `${total} ${matches.length === 1 ? 'result' : 'results'}`;
}

function Toggle({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`icon-btn icon-btn-sm ${active ? 'active' : ''}`} aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function IconButton({ label, onClick, disabled, children, testId }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; testId?: string }) {
  return (
    <button type="button" className="icon-btn icon-btn-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

export interface SearchRequest {
  replace: boolean;
  /** Changes on every request, so asking again (Ctrl+F while the panel is open) refocuses it. */
  key: number;
}

interface SearchPanelProps {
  view: EditorView;
  store: ViewStore;
  /** The panel's container, created by CodeMirror (see `searchPanel`). */
  container: HTMLElement;
  request: SearchRequest | null;
  canReplace: boolean;
  onFindAll: (query: SearchQuery) => void;
  notify: (message: string) => void;
}

export function SearchPanel({ view, store, container, request, canReplace, onFindAll, notify }: SearchPanelProps) {
  const state = useViewState(store, view);
  const query = getSearchQuery(state);
  const counted = useMatches(state);
  const [replaceOpen, setReplaceOpen] = useState(() => canReplace && !!request?.replace);
  const [seenRequest, setSeenRequest] = useState(request?.key);
  if (request && request.key !== seenRequest) {
    setSeenRequest(request.key);
    if (request.replace && canReplace) setReplaceOpen(true);
  }
  const searchInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  // Focuses the panel when it opens and on every new request, but not on other renders.
  useEffect(() => {
    const target = request?.replace && canReplace && getSearchQuery(view.state).search ? replaceInput.current : searchInput.current;
    target?.focus();
    target?.select();
  }, [request?.key]);

  const replaceEverything = () => {
    const count = findMatches(view.state, getSearchQuery(view.state), Infinity).length;
    if (!count) notify('Nothing to replace');
    else if (replaceAll(view)) notify(`Replaced ${plural(count, 'occurrence')}`);
  };

  const bookmarkAll = () => {
    const matches = findMatches(view.state, getSearchQuery(view.state), Infinity);
    if (!matches.length) {
      notify('No results to bookmark');
      return;
    }
    addBookmarks(view, matches.map((match) => match.from));
    const lines = new Set(matches.map((match) => view.state.doc.lineAt(match.from).number)).size;
    notify(`Bookmarked ${plural(lines, 'line')}`);
  };

  const selectAll = () => {
    if (selectMatches(view)) view.focus();
    else notify('No results to select');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (event.target === searchInput.current) {
      event.preventDefault();
      if (event.altKey) selectAll();
      else if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.target === replaceInput.current) {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && event.altKey) replaceEverything();
      else replaceNext(view);
    }
  };

  const invalid = !!query.search && !query.valid;
  const status = matchStatus(state, counted.query, counted.matches);

  return createPortal(
    <div className="code-search" role="search" aria-label="Find and replace" onKeyDown={onKeyDown} data-testid="code-search">
      <div className="code-search-row">
        {canReplace ? (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={replaceOpen ? 'Hide replace' : 'Show replace'}
            aria-expanded={replaceOpen}
            title="Toggle replace"
            onClick={() => setReplaceOpen((open) => !open)}
          >
            {replaceOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="code-search-gap" />
        )}
        <div className={`find-input ${invalid ? 'invalid' : ''}`}>
          <input
            ref={searchInput}
            main-field="true"
            value={query.search}
            placeholder="Find"
            aria-label="Find"
            aria-invalid={invalid}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => updateQuery(view, { search: event.target.value })}
            data-testid="code-find-input"
          />
          <Toggle label="Match case" active={query.caseSensitive} onClick={() => updateQuery(view, { caseSensitive: !query.caseSensitive })}>
            <CaseSensitive size={16} />
          </Toggle>
          <Toggle label="Match whole word only" active={query.wholeWord} onClick={() => updateQuery(view, { wholeWord: !query.wholeWord })}>
            <WholeWord size={16} />
          </Toggle>
        </div>
        <select
          className="code-search-mode"
          aria-label="Search mode"
          title="Search mode"
          value={modeOf(query)}
          onChange={(event) => updateQuery(view, MODES[event.target.value as SearchMode])}
          data-testid="code-search-mode"
        >
          <option value="normal">Normal</option>
          <option value="extended">Extended (\n, \t)</option>
          <option value="regexp">Regular expression</option>
        </select>
        <span className="find-status" aria-live="polite" data-testid="code-find-status">
          {status}
        </span>
        <IconButton label={`Previous match (Shift+Enter, ${keyLabel(KEYS.findPrevious)})`} onClick={() => findPrevious(view)} disabled={!query.valid}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label={`Next match (Enter, ${keyLabel(KEYS.findNext)})`} onClick={() => findNext(view)} disabled={!query.valid}>
          <ArrowDown size={16} />
        </IconButton>
        <IconButton label="Find all (list the matching lines)" onClick={() => onFindAll(query)} disabled={!query.valid} testId="code-find-all">
          <ListFilter size={16} />
        </IconButton>
        <IconButton label="Bookmark the matching lines" onClick={bookmarkAll} disabled={!query.valid} testId="code-bookmark-all">
          <BookmarkPlus size={16} />
        </IconButton>
        <IconButton label="Select all matches (Alt+Enter)" onClick={selectAll} disabled={!query.valid}>
          <TextCursorInput size={16} />
        </IconButton>
        <span className="spacer" />
        <IconButton label="Close (Escape)" onClick={() => closeSearchPanel(view)}>
          <X size={16} />
        </IconButton>
      </div>
      {canReplace && replaceOpen && (
        <div className="code-search-row">
          <span className="code-search-gap" />
          <div className="find-input">
            <input
              ref={replaceInput}
              value={query.replace}
              placeholder={query.regexp ? 'Replace ($1 for groups)' : 'Replace'}
              aria-label="Replace with"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateQuery(view, { replace: event.target.value })}
              data-testid="code-replace-input"
            />
          </div>
          <button type="button" className="btn btn-sm" disabled={!query.valid} onClick={() => replaceNext(view)} data-testid="code-replace-one">
            Replace
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!query.valid}
            title={`Replace all (${shortcut('Mod-Alt-Enter')})`}
            onClick={replaceEverything}
            data-testid="code-replace-all"
          >
            Replace all
          </button>
        </div>
      )}
    </div>,
    container,
  );
}

// ------------------------------------------------------------------ find all

/** Lines listed by Find all. */
const RESULT_LINES = 1000;
/** Characters shown before the first match of a long line. */
const CONTEXT = 60;
const SNIPPET = 300;

interface ResultLine {
  number: number;
  from: number;
  text: string;
  /** Matches, relative to the start of the line (clipped to it). */
  ranges: Match[];
}

function collectResults(state: EditorState, query: SearchQuery): { hits: number; lineCount: number; lines: ResultLine[] } {
  const matches = findMatches(state, query, LIMIT + 1);
  const lines: ResultLine[] = [];
  let lineCount = 0;
  let last = 0;
  for (const match of matches) {
    const line = state.doc.lineAt(match.from);
    if (line.number !== last) {
      last = line.number;
      lineCount += 1;
      if (lines.length < RESULT_LINES) lines.push({ number: line.number, from: line.from, text: line.text, ranges: [] });
      else continue;
    }
    const entry = lines.at(-1);
    if (entry?.number === line.number) entry.ranges.push({ from: match.from - line.from, to: Math.min(match.to, line.to) - line.from });
  }
  return { hits: matches.length, lineCount, lines };
}

/** The line's text around its matches, with the matches highlighted. */
function Snippet({ text, ranges }: { text: string; ranges: Match[] }) {
  const start = text.length > SNIPPET ? Math.max(0, (ranges[0]?.from ?? 0) - CONTEXT) : 0;
  const end = Math.min(text.length, start + SNIPPET);
  const parts: ReactNode[] = start > 0 ? ['…'] : [];
  let position = start;
  ranges.forEach((range, index) => {
    const from = Math.max(range.from, position);
    const to = Math.min(range.to, end);
    if (from >= end || to <= from) return;
    if (from > position) parts.push(text.slice(position, from));
    parts.push(<mark key={index}>{text.slice(from, to)}</mark>);
    position = to;
  });
  if (end > position) parts.push(text.slice(position, end));
  if (end < text.length) parts.push('…');
  return <>{parts}</>;
}

interface ResultsPanelProps {
  view: EditorView;
  store: ViewStore;
  query: SearchQuery;
  onClose: () => void;
}

/** Search ▸ Find all: the matching lines, updated as the file changes. Clicking one selects its first match. */
export function ResultsPanel({ view, store, query, onClose }: ResultsPanelProps) {
  const state = useViewState(store, view);
  const deferred = useDeferredValue(state);
  const results = useMemo(() => collectResults(deferred, query), [deferred.doc, query]);
  const hits = results.hits > LIMIT ? `${LIMIT.toLocaleString()}+ hits` : plural(results.hits, 'hit');

  const select = (line: ResultLine) => {
    const { length } = view.state.doc;
    const range = line.ranges[0];
    const from = Math.min(line.from + (range?.from ?? 0), length);
    const to = Math.min(line.from + (range?.to ?? 0), length);
    view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    view.focus();
  };

  return (
    <section className="code-results no-print" aria-label="Find results" data-testid="code-results">
      <header className="code-results-header">
        <strong>Find results</strong>
        <span className="muted">
          {hits} in {plural(results.lineCount, 'line')} for “{query.search}”
          {results.lineCount > results.lines.length && ` (showing the first ${RESULT_LINES.toLocaleString()} lines)`}
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Close find results" title="Close find results" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {results.lines.length ? (
        <ol className="code-results-list">
          {results.lines.map((line) => (
            <li key={line.number}>
              <button type="button" className="code-result" onClick={() => select(line)}>
                <span className="code-result-line">{line.number.toLocaleString()}</span>
                <span className="code-result-text">
                  <Snippet text={line.text} ranges={line.ranges} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="code-results-empty muted">No lines match.</p>
      )}
    </section>
  );
}
