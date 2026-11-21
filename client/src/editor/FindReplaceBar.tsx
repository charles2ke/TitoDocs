import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord, X } from 'lucide-react';
import { getSearchState } from './find-replace';

interface FindReplaceBarProps {
  editor: Editor;
  showReplace: boolean;
  onToggleReplace: () => void;
  onClose: () => void;
  /** Changes whenever the bar is requested again (Ctrl+F while open), to refocus the search box. */
  focusKey: number;
}

const MAX_MATCHES = 5000;

/** The selected text, if it is short enough to search for. */
function selectedText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  const text = editor.state.doc.textBetween(from, to, '\n');
  return text.length <= 200 && !text.includes('\n') ? text : '';
}

function Toggle({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`icon-btn icon-btn-sm ${active ? 'active' : ''}`} aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Find and replace (Ctrl+F / Ctrl+H), with match case, whole word and regular expression options. */
export function FindReplaceBar({ editor, showReplace, onToggleReplace, onClose, focusKey }: FindReplaceBarProps) {
  const [term, setTerm] = useState(() => selectedText(editor));
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const search = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = getSearchState(current.state);
      return { count: state.matches.length, current: state.current, error: state.error, editable: current.isEditable };
    },
  });

  useEffect(() => {
    const selected = selectedText(editor);
    if (selected) setTerm(selected);
    findInput.current?.focus();
    findInput.current?.select();
  }, [editor, focusKey]);

  useEffect(() => {
    if (showReplace) replaceInput.current?.focus();
  }, [showReplace]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.commands.setSearchQuery(term ? { term, caseSensitive, wholeWord, regex } : null);
    // Show the first match after the cursor without moving the cursor (like most editors while typing).
    editor.view.dom.querySelector('.search-match-current')?.scrollIntoView({ block: 'center' });
  }, [editor, term, caseSensitive, wholeWord, regex]);

  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.commands.setSearchQuery(null);
    },
    [editor],
  );

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) editor.commands.findPrevious();
      else editor.commands.findNext();
    }
  };

  const onReplaceKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && event.altKey) editor.commands.replaceAll(replacement);
      else editor.commands.replaceCurrent(replacement);
    }
  };

  // The replace buttons are disabled once nothing matches, which would drop focus to the page.
  const keepFocus = () => {
    if (!getSearchState(editor.state).matches.length) replaceInput.current?.focus();
  };

  // Escape closes the bar from any of its controls, not only the inputs.
  const onBarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  let status = '';
  if (search.error) status = 'Invalid pattern';
  else if (search.count) status = `${search.current + 1} of ${search.count >= MAX_MATCHES ? `${MAX_MATCHES}+` : search.count}`;
  else if (term) status = 'No results';

  return (
    <div className="find-bar no-print" role="search" aria-label="Find and replace" data-testid="find-bar" onKeyDown={onBarKey}>
      {search.editable ? (
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label={showReplace ? 'Hide replace' : 'Show replace'}
          aria-expanded={showReplace}
          title="Toggle replace"
          onClick={onToggleReplace}
        >
          {showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      ) : (
        <span />
      )}
      <div className="find-bar-row">
        <div className={`find-input ${search.error ? 'invalid' : ''}`}>
          <input
            ref={findInput}
            value={term}
            placeholder="Find"
            aria-label="Find"
            title={search.error ?? undefined}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onFindKey}
            data-testid="find-input"
          />
          <Toggle label="Match case" active={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}>
            <CaseSensitive size={16} />
          </Toggle>
          <Toggle label="Whole word" active={wholeWord} onClick={() => setWholeWord((value) => !value)}>
            <WholeWord size={16} />
          </Toggle>
          <Toggle label="Use regular expression" active={regex} onClick={() => setRegex((value) => !value)}>
            <Regex size={16} />
          </Toggle>
        </div>
        <span className="find-status" aria-live="polite" data-testid="find-status">
          {status}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!search.count}
          onClick={() => editor.commands.findPrevious()}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={!search.count}
          onClick={() => editor.commands.findNext()}
        >
          <ArrowDown size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Close find" title="Close (Escape)" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {showReplace && search.editable && (
        <div className="find-bar-row find-bar-replace">
          <div className="find-input">
            <input
              ref={replaceInput}
              value={replacement}
              placeholder={regex ? 'Replace ($1 for groups)' : 'Replace'}
              aria-label="Replace with"
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={onReplaceKey}
              data-testid="replace-input"
            />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!search.count}
            onClick={() => {
              editor.commands.replaceCurrent(replacement);
              keepFocus();
            }}
            data-testid="replace-one"
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!search.count}
            title="Replace all (Ctrl+Alt+Enter)"
            onClick={() => {
              editor.commands.replaceAll(replacement);
              keepFocus();
            }}
            data-testid="replace-all"
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
