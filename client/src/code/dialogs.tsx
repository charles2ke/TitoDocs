// Dialogs of the code editor: go to line, column editor, language, summary, hashes, compare and macros.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { EditorState } from '@codemirror/state';
import { Check, Copy } from 'lucide-react';
import * as Y from 'yjs';
import { CODE_FIELD, type FileMeta, type VersionMeta } from '@shared/types';
import { api, errorMessage } from '../api';
import { acquireRoom, type Room } from '../collab';
import { Dialog } from '../components/Dialog';
import type { ShortcutGroup } from '../components/ShortcutsDialog';
import { Spinner } from '../components/ui';
import { readTextFile } from '../lib/files';
import { formatDateTime, pickFile } from '../lib/util';
import { displayKeys, KEYS, type FileSettings } from './editorSetup';
import { LANGUAGES, PLAIN_TEXT } from './languages';
import { describeMacro, type MacroStep } from './macro';
import {
  applyEol,
  encodeText,
  ENCODING_LABELS,
  EOL_LABELS,
  hashText,
  normalizeEol,
  numberSequence,
  summarize,
  type HashAlgorithm,
  type NumberSequence,
} from './textOps';

interface Actions {
  onCancel: () => void;
  confirmLabel: string;
  busy?: boolean;
}

function DialogActions({ onCancel, confirmLabel, busy }: Actions) {
  return (
    <div className="dialog-actions">
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {confirmLabel}
      </button>
    </div>
  );
}

const FormError = ({ error }: { error: string }) =>
  error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;

// ------------------------------------------------------------------ go to line

export function GoToLineDialog({ state, onGo, onClose }: { state: EditorState; onGo: (line: number, column: number) => void; onClose: () => void }) {
  const { doc } = state;
  const current = doc.lineAt(state.selection.main.head).number;
  const [value, setValue] = useState(String(current));
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const match = /^\s*(\d+)\s*(?:[:,]\s*(\d+)\s*)?$/.exec(value);
    const line = match ? Number(match[1]) : 0;
    if (!match || line < 1 || line > doc.lines) {
      setError(`Enter a line from 1 to ${doc.lines.toLocaleString()}, optionally followed by a column (like 12:5).`);
      return;
    }
    onGo(line, match[2] ? Math.max(1, Number(match[2])) : 1);
  };
  return (
    <Dialog title="Go to line" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Line number (and column)</span>
          <input
            autoFocus
            inputMode="numeric"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            onFocus={(event) => event.target.select()}
            data-testid="goto-line-input"
          />
        </label>
        <p className="hint">
          You are on line {current.toLocaleString()} of {doc.lines.toLocaleString()}.
        </p>
        <FormError error={error} />
        <DialogActions onCancel={onClose} confirmLabel="Go" />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ column editor

const parseInteger = (value: string): number => (/^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN);

/** Edit ▸ Column editor: inserts a text, or a sequence of numbers, on each line from the cursor's column. */
export function ColumnEditorDialog({ count, onInsert, onClose }: { count: number; onInsert: (texts: string[]) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'text' | 'number'>('text');
  const [text, setText] = useState('');
  const [initial, setInitial] = useState('1');
  const [step, setStep] = useState('1');
  const [repeat, setRepeat] = useState('1');
  const [base, setBase] = useState<NumberSequence['base']>(10);
  const [pad, setPad] = useState<NumberSequence['pad']>('none');
  const [error, setError] = useState('');

  const numbers = useMemo(() => {
    const options = { initial: parseInteger(initial), step: parseInteger(step), repeat: parseInteger(repeat), base, pad };
    const valid = Number.isSafeInteger(options.initial) && Number.isSafeInteger(options.step) && Number.isSafeInteger(options.repeat) && options.repeat >= 1;
    return valid ? numberSequence(count, options) : null;
  }, [count, initial, step, repeat, base, pad]);
  const texts = mode === 'text' ? Array.from({ length: count }, () => text) : numbers;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!texts) {
      setError('Enter whole numbers, and repeat each number at least once.');
      return;
    }
    if (mode === 'text' && !text) {
      setError('Enter the text to insert.');
      return;
    }
    onInsert(texts);
  };

  return (
    <Dialog title="Column editor" onClose={onClose}>
      <form className="form code-dialog" onSubmit={submit} data-testid="column-editor">
        <fieldset className="segmented">
          <legend>Insert</legend>
          <label>
            <input type="radio" name="column-mode" checked={mode === 'text'} onChange={() => setMode('text')} />
            Text
          </label>
          <label>
            <input type="radio" name="column-mode" checked={mode === 'number'} onChange={() => setMode('number')} />
            Numbers
          </label>
        </fieldset>
        {mode === 'text' ? (
          <label className="field">
            <span>Text to insert</span>
            <input autoFocus value={text} onChange={(event) => setText(event.target.value)} data-testid="column-text" />
          </label>
        ) : (
          <div className="column-number-grid">
            <label className="field">
              <span>Initial number</span>
              <input autoFocus inputMode="numeric" value={initial} onChange={(event) => setInitial(event.target.value)} data-testid="column-initial" />
            </label>
            <label className="field">
              <span>Increase by</span>
              <input inputMode="numeric" value={step} onChange={(event) => setStep(event.target.value)} />
            </label>
            <label className="field">
              <span>Repeat each</span>
              <input inputMode="numeric" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
            </label>
            <label className="field">
              <span>Format</span>
              <select value={base} onChange={(event) => setBase(Number(event.target.value) as NumberSequence['base'])}>
                <option value={10}>Decimal</option>
                <option value={16}>Hexadecimal</option>
                <option value={8}>Octal</option>
                <option value={2}>Binary</option>
              </select>
            </label>
            <label className="field">
              <span>Leading</span>
              <select value={pad} onChange={(event) => setPad(event.target.value as NumberSequence['pad'])}>
                <option value="none">None</option>
                <option value="zeros">Zeros</option>
                <option value="spaces">Spaces</option>
              </select>
            </label>
          </div>
        )}
        <div>
          <p className="hint">
            Inserts on {count.toLocaleString()} {count === 1 ? 'line' : 'lines'}
            {texts && texts.length > 0 && ', starting with:'}
          </p>
          {texts && texts.length > 0 && (
            <pre className="column-preview" aria-label="Preview">
              {texts.slice(0, 4).join('\n')}
              {texts.length > 4 && '\n…'}
            </pre>
          )}
        </div>
        <FormError error={error} />
        <DialogActions onCancel={onClose} confirmLabel="Insert" />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ language

interface LanguageDialogProps {
  /** The file's language setting: a language name, `PLAIN_TEXT`, or null to detect it from the file name. */
  current: string | null;
  detected: string | null;
  onSelect: (language: string | null) => void;
  onClose: () => void;
}

export function LanguageDialog({ current, detected, onSelect, onClose }: LanguageDialogProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase().replace(/^\*?\./, '');
  const matches = useMemo(
    () =>
      LANGUAGES.filter(
        (language) =>
          !needle ||
          language.name.toLowerCase().includes(needle) ||
          language.alias.some((alias) => alias.includes(needle)) ||
          language.extensions.includes(needle),
      ),
    [needle],
  );
  const choose = (language: string | null) => {
    onSelect(language);
    onClose();
  };
  const option = (key: string, label: string, value: string | null, detail?: string) => (
    <li key={key}>
      <button type="button" className="language-option" aria-pressed={current === value} onClick={() => choose(value)}>
        <span className="language-check">{current === value && <Check size={14} />}</span>
        <span className="language-name">{label}</span>
        {detail && <span className="muted">{detail}</span>}
      </button>
    </li>
  );
  return (
    <Dialog title="Language" onClose={onClose}>
      <input
        type="search"
        className="language-search"
        placeholder="Search by name or file extension"
        aria-label="Search languages"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches[0]) {
            event.preventDefault();
            choose(matches[0].name);
          }
        }}
        autoFocus
        data-testid="language-search"
      />
      <ul className="language-list" aria-label="Languages">
        {!needle && option('auto', 'Auto-detect', null, detected ? `From the file name: ${detected}` : 'Not recognised from the file name')}
        {!needle && option('plain', PLAIN_TEXT, PLAIN_TEXT, 'No syntax highlighting')}
        {matches.map((language) =>
          option(
            language.name,
            language.name,
            language.name,
            language.extensions
              .slice(0, 4)
              .map((extension) => `.${extension}`)
              .join(' '),
          ),
        )}
        {!matches.length && <li className="muted language-empty">No languages match “{query.trim()}”.</li>}
      </ul>
    </Dialog>
  );
}

// ------------------------------------------------------------------ summary

interface SummaryDialogProps {
  state: EditorState;
  file: FileMeta;
  settings: FileSettings;
  onClose: () => void;
}

/** View ▸ Summary, as in Notepad++. */
export function SummaryDialog({ state, file, settings, onClose }: SummaryDialogProps) {
  const stats = useMemo(() => {
    const text = state.doc.toString();
    const ranges = state.selection.ranges.filter((range) => !range.empty);
    return {
      summary: summarize(text),
      bytes: encodeText(applyEol(text, settings.eol), settings.encoding).length,
      selected: ranges.reduce((total, range) => total + range.to - range.from, 0),
      ranges: ranges.length,
    };
  }, [state, settings]);
  const number = (value: number) => value.toLocaleString();
  const rows: [string, string][] = [
    ['Created', formatDateTime(file.createdAt)],
    ['Modified', `${formatDateTime(file.updatedAt)}${file.updatedByName ? ` by ${file.updatedByName}` : ''}`],
    ['Characters (without line endings)', number(stats.summary.characters)],
    ['Characters (without blanks)', number(stats.summary.nonBlank)],
    ['Words', number(stats.summary.words)],
    ['Lines', number(stats.summary.lines)],
    ['Size when downloaded', `${number(stats.bytes)} bytes (${ENCODING_LABELS[settings.encoding]}, ${EOL_LABELS[settings.eol]})`],
  ];
  if (stats.ranges) rows.push(['Selected', `${number(stats.selected)} characters in ${stats.ranges} ${stats.ranges === 1 ? 'range' : 'ranges'}`]);
  return (
    <Dialog title="Summary" onClose={onClose}>
      <table className="stats-table" data-testid="code-summary">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ hashes

export const HASH_ALGORITHMS: HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

interface HashDialogProps {
  initial: HashAlgorithm;
  text: string;
  selection: boolean;
  eol: FileSettings['eol'];
  onCopy: (hash: string) => void;
  onClose: () => void;
}

/** Tools ▸ Hash: a digest of the selection or the whole file, as UTF-8 with the file's line endings. */
export function HashDialog({ initial, text, selection, eol, onCopy, onClose }: HashDialogProps) {
  const [algorithm, setAlgorithm] = useState(initial);
  const [result, setResult] = useState<{ algorithm: HashAlgorithm; hash: string } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      setResult({ error: 'Your browser only computes hashes on secure (https) connections.' });
      return;
    }
    hashText(applyEol(text, eol), algorithm).then(
      (hash) => !cancelled && setResult({ algorithm, hash }),
      (error) => !cancelled && setResult({ error: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [text, eol, algorithm]);
  return (
    <Dialog title="Hash" onClose={onClose}>
      <div className="form code-dialog">
        <label className="field">
          <span>Algorithm</span>
          <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as HashAlgorithm)} data-testid="hash-algorithm">
            {HASH_ALGORITHMS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Of {selection ? 'the selected text' : 'the whole file'}, as UTF-8 with {EOL_LABELS[eol]} line endings.
        </p>
        {result === null && <Spinner label="Computing" />}
        {result && 'error' in result && <FormError error={result.error} />}
        {result && 'hash' in result && (
          <output className="hash-output" data-testid="hash-output">
            {result.hash}
          </output>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={!result || !('hash' in result)}
            onClick={() => result && 'hash' in result && onCopy(result.hash)}
          >
            <Copy size={16} /> Copy
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ compare

export interface CompareSource {
  label: string;
  text: string;
}

/** Resolves once a room has the server's copy, failing after a timeout or when access is refused. */
function syncRoom(room: Room, timeout = 15_000): Promise<void> {
  const { provider } = room;
  if (provider.isSynced) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSynced = ({ state }: { state: boolean }) => state && finish(null);
    const onDenied = () => finish(new Error('You don’t have access to this file.'));
    const finish = (error: Error | null) => {
      clearTimeout(timer);
      provider.off('synced', onSynced);
      provider.off('authenticationFailed', onDenied);
      if (error) reject(error);
      else resolve();
    };
    timer = setTimeout(() => finish(new Error('The file took too long to load.')), timeout);
    provider.on('synced', onSynced);
    provider.on('authenticationFailed', onDenied);
  });
}

async function loadCodeFile(id: string): Promise<string> {
  const { room, release } = acquireRoom(id);
  try {
    await syncRoom(room);
    return normalizeEol(room.doc.getText(CODE_FIELD).toString());
  } finally {
    release();
  }
}

async function loadVersion(fileId: string, versionId: string): Promise<string> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, await api.versionState(fileId, versionId));
    return normalizeEol(doc.getText(CODE_FIELD).toString());
  } finally {
    doc.destroy();
  }
}

type CompareKind = 'file' | 'version' | 'local' | 'paste';

interface CompareDialogProps {
  file: FileMeta;
  /** Saved versions are only available to editors. */
  canSeeVersions: boolean;
  onCompare: (source: CompareSource) => void;
  onClose: () => void;
}

/** Tools ▸ Compare: picks what to compare the file with (like Notepad++'s Compare plugin). */
export function CompareDialog({ file, canSeeVersions, onCompare, onClose }: CompareDialogProps) {
  const [kind, setKind] = useState<CompareKind>('file');
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [fileId, setFileId] = useState('');
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.listFiles('recent', 'code').then(
      ({ files: list }) => {
        if (cancelled) return;
        const others = list.filter((other) => other.id !== file.id);
        setFiles(others);
        setFileId(others[0]?.id ?? '');
      },
      (caught) => {
        if (cancelled) return;
        setFiles([]);
        setError(errorMessage(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  useEffect(() => {
    if (kind !== 'version' || versions) return;
    let cancelled = false;
    api.versions(file.id).then(
      ({ versions: list }) => {
        if (cancelled) return;
        setVersions(list);
        setVersionId(list[0]?.id ?? '');
      },
      (caught) => {
        if (cancelled) return;
        setVersions([]);
        setError(errorMessage(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, versions, file.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    // The file picker has to open while the click still counts as a user action, so before any await.
    const picking = kind === 'local' ? pickFile('') : null;
    setBusy(true);
    try {
      let source: CompareSource;
      if (kind === 'file') {
        const other = files?.find((candidate) => candidate.id === fileId);
        if (!other) throw new Error('Choose a file to compare with.');
        source = { label: other.title, text: await loadCodeFile(other.id) };
      } else if (kind === 'version') {
        const version = versions?.find((candidate) => candidate.id === versionId);
        if (!version) throw new Error('Choose a version to compare with.');
        source = { label: version.name ?? formatDateTime(version.createdAt), text: await loadVersion(file.id, version.id) };
      } else if (kind === 'local') {
        const picked = await picking;
        if (!picked) return;
        const { text } = await readTextFile(picked);
        source = { label: picked.name, text: normalizeEol(text) };
      } else {
        source = { label: 'Pasted text', text: normalizeEol(pasted) };
      }
      // The dialog may have been closed while the text was loading.
      if (mounted.current) onCompare(source);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const kinds: [CompareKind, string][] = [
    ['file', 'Another code file'],
    ...(canSeeVersions ? ([['version', 'A saved version']] as [CompareKind, string][]) : []),
    ['local', 'A file on this device'],
    ['paste', 'Pasted text'],
  ];

  return (
    <Dialog title={`Compare “${file.title}” with`} onClose={onClose}>
      <form className="form code-dialog" onSubmit={submit} data-testid="compare-dialog">
        <fieldset className="compare-kinds">
          <legend>Compare with</legend>
          {kinds.map(([value, label]) => (
            <label key={value} className="checkbox-field">
              <input type="radio" name="compare-kind" checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        {kind === 'file' &&
          (files === null ? (
            <Spinner label="Loading files" />
          ) : files.length ? (
            <label className="field">
              <span>File</span>
              <select value={fileId} onChange={(event) => setFileId(event.target.value)} data-testid="compare-file">
                {files.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.title}
                    {other.ownerName ? ` (${other.ownerName})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="hint">You have no other code files.</p>
          ))}
        {kind === 'version' &&
          (versions === null ? (
            <Spinner label="Loading versions" />
          ) : versions.length ? (
            <label className="field">
              <span>Version</span>
              <select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name ? `${version.name} (${formatDateTime(version.createdAt)})` : formatDateTime(version.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="hint">This file has no saved versions yet.</p>
          ))}
        {kind === 'local' && <p className="hint">Choose a text file after pressing Compare. Nothing is uploaded.</p>}
        {kind === 'paste' && (
          <label className="field">
            <span>Text</span>
            <textarea
              rows={8}
              className="compare-paste"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              spellCheck={false}
              data-testid="compare-paste"
            />
          </label>
        )}
        <FormError error={error} />
        <DialogActions onCancel={onClose} confirmLabel={busy ? 'Loading…' : 'Compare'} busy={busy} />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ macros

export function RunMacroDialog({ steps, onRun, onClose }: { steps: readonly MacroStep[]; onRun: (times: number | 'end') => void; onClose: () => void }) {
  const [mode, setMode] = useState<'times' | 'end'>('times');
  const [times, setTimes] = useState('2');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'end') {
      onRun('end');
      return;
    }
    const count = parseInteger(times);
    if (!Number.isInteger(count) || count < 1 || count > 10_000) {
      setError('Enter a number of times from 1 to 10,000.');
      return;
    }
    onRun(count);
  };
  return (
    <Dialog title="Run a macro multiple times" onClose={onClose}>
      <form className="form code-dialog" onSubmit={submit}>
        <p className="hint">The recorded macro has {describeMacro(steps)}.</p>
        <fieldset className="compare-kinds">
          <legend>Run</legend>
          <label className="checkbox-field">
            <input type="radio" name="macro-mode" checked={mode === 'times'} onChange={() => setMode('times')} />
            <span>
              <input
                className="macro-times"
                aria-label="Number of times"
                inputMode="numeric"
                value={times}
                onChange={(event) => {
                  setTimes(event.target.value);
                  setMode('times');
                  setError('');
                }}
                data-testid="macro-times"
              />{' '}
              times
            </span>
          </label>
          <label className="checkbox-field">
            <input type="radio" name="macro-mode" checked={mode === 'end'} onChange={() => setMode('end')} />
            Until the end of the file
          </label>
        </fieldset>
        <FormError error={error} />
        <DialogActions onCancel={onClose} confirmLabel="Run" />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ keyboard shortcuts

export const CODE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'File',
    items: [
      ['Open file', KEYS.open],
      ['Print', KEYS.print],
      ['Version history', KEYS.versions],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Undo', KEYS.undo],
      ['Redo', KEYS.redo],
      ['Select all', KEYS.selectAll],
      ['Duplicate line', KEYS.duplicateLine],
      ['Delete line', KEYS.deleteLine],
      ['Move line up', displayKeys(KEYS.moveLineUp)],
      ['Move line down', displayKeys(KEYS.moveLineDown)],
      ['Join lines', KEYS.joinLines],
      ['Insert blank line above', KEYS.blankLineAbove],
      ['Insert blank line below', KEYS.blankLineBelow],
      ['Indent', KEYS.indent],
      ['Outdent', KEYS.outdent],
      ['Toggle line comment', KEYS.toggleComment],
      ['Toggle block comment', KEYS.toggleBlockComment],
      ['UPPERCASE', KEYS.upperCase],
      ['lowercase', KEYS.lowerCase],
      ['Proper Case', KEYS.properCase],
      ['Sentence case', KEYS.sentenceCase],
      ['Column editor', KEYS.columnEditor],
      ['Column (rectangular) selection', 'Alt-Drag'],
      ['Add a cursor', 'Mod-Click'],
    ],
  },
  {
    title: 'Search',
    items: [
      ['Find', KEYS.find],
      ['Replace', KEYS.replace],
      ['Find next', KEYS.findNext],
      ['Find previous', KEYS.findPrevious],
      ['Select and find next', KEYS.selectFindNext],
      ['Select and find previous', KEYS.selectFindPrevious],
      ['Select next occurrence', KEYS.selectNextOccurrence],
      ['Go to line', KEYS.goToLine],
      ['Go to matching bracket', KEYS.matchingBracket],
      ['Select to matching bracket', KEYS.selectToBracket],
      ['Toggle bookmark', KEYS.toggleBookmark],
      ['Next bookmark', KEYS.nextBookmark],
      ['Previous bookmark', KEYS.previousBookmark],
    ],
  },
  {
    title: 'View',
    items: [
      ['Word wrap', KEYS.wrap],
      ['Zoom in', KEYS.zoomIn],
      ['Zoom out', KEYS.zoomOut],
      ['Restore default zoom', KEYS.zoomReset],
      ['Fold', KEYS.fold],
      ['Unfold', KEYS.unfold],
      ['Fold all', KEYS.foldAll],
      ['Unfold all', KEYS.unfoldAll],
    ],
  },
  {
    title: 'Macro',
    items: [
      ['Start or stop recording', KEYS.record],
      ['Play back', KEYS.playback],
    ],
  },
];
