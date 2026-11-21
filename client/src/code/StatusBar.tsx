// The status bar below the code editor, as in Notepad++: language, size, cursor position, indentation, line endings, encoding and zoom.
import { countColumn } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Circle, Lock } from 'lucide-react';
import { Dropdown, separator, type MenuEntry } from '../components/Menu';
import { keyLabel, KEYS, stepZoom, TAB_SIZES, useViewState, ZOOM_STEPS, type FileSettings, type ViewStore } from './editorSetup';
import { ENCODING_LABELS, EOL_LABELS, type Eol, type TextEncodingName } from './textOps';

interface StatusBarProps {
  view: EditorView;
  store: ViewStore;
  /** The name of the language used for highlighting. */
  language: string;
  file: FileSettings;
  zoom: number;
  /** Whether the user may change the file's settings (indentation, line endings, encoding). */
  editable: boolean;
  recording: boolean;
  onLanguage: () => void;
  onGoToLine: () => void;
  onFileSettings: (settings: Partial<FileSettings>) => void;
  onDetectIndentation: () => void;
  onZoom: (zoom: number) => void;
  onStopRecording: () => void;
}

function StatusMenu({ text, title, items, testId }: { text: string; title: string; items: () => MenuEntry[]; testId: string }) {
  return (
    <Dropdown
      items={items}
      align="end"
      label={title}
      trigger={(props) => (
        <button type="button" className="status-item" title={title} aria-label={`${title}: ${text}`} data-testid={testId} {...props}>
          {text}
        </button>
      )}
    />
  );
}

const count = (value: number, word: string): string => `${value.toLocaleString()} ${word}${value === 1 ? '' : 's'}`;

export function StatusBar(props: StatusBarProps) {
  const { view, store, language, file, zoom, editable, recording } = props;
  const state = useViewState(store, view);
  const { main, ranges } = state.selection;
  const line = state.doc.lineAt(main.head);
  const column = countColumn(line.text, state.tabSize, main.head - line.from) + 1;
  const selected = ranges.reduce((total, range) => total + range.to - range.from, 0);
  const position = `Ln ${line.number.toLocaleString()}, Col ${column.toLocaleString()}`;
  const selection = ranges.length > 1 ? ` (${count(ranges.length, 'selection')}, ${selected.toLocaleString()} selected)` : selected ? ` (${selected.toLocaleString()} selected)` : '';
  const indentation = file.useTabs ? `Tab size: ${file.tabSize}` : `Spaces: ${file.tabSize}`;

  const indentationItems = (): MenuEntry[] => [
    { type: 'label', label: 'Indent using' },
    { label: 'Spaces', checked: !file.useTabs, onSelect: () => props.onFileSettings({ useTabs: false }) },
    { label: 'Tabs', checked: file.useTabs, onSelect: () => props.onFileSettings({ useTabs: true }) },
    separator,
    { type: 'label', label: file.useTabs ? 'Tab size' : 'Indent size' },
    ...TAB_SIZES.map((size): MenuEntry => ({ label: String(size), checked: file.tabSize === size, onSelect: () => props.onFileSettings({ tabSize: size }) })),
    separator,
    { label: 'Detect from content', onSelect: props.onDetectIndentation },
  ];
  const eolItems = (): MenuEntry[] =>
    (Object.keys(EOL_LABELS) as Eol[]).map((eol) => ({ label: EOL_LABELS[eol], checked: file.eol === eol, onSelect: () => props.onFileSettings({ eol }) }));
  const encodingItems = (): MenuEntry[] =>
    (Object.keys(ENCODING_LABELS) as TextEncodingName[]).map((encoding) => ({
      label: ENCODING_LABELS[encoding],
      checked: file.encoding === encoding,
      onSelect: () => props.onFileSettings({ encoding }),
    }));
  const zoomItems = (): MenuEntry[] => [
    { label: 'Zoom in', shortcut: keyLabel(KEYS.zoomIn), disabled: stepZoom(zoom, 1) === zoom, onSelect: () => props.onZoom(stepZoom(zoom, 1)) },
    { label: 'Zoom out', shortcut: keyLabel(KEYS.zoomOut), disabled: stepZoom(zoom, -1) === zoom, onSelect: () => props.onZoom(stepZoom(zoom, -1)) },
    separator,
    ...ZOOM_STEPS.map((step): MenuEntry => ({ label: `${step}%`, checked: zoom === step, onSelect: () => props.onZoom(step) })),
  ];

  return (
    <footer className="code-statusbar no-print" aria-label="Status bar" data-testid="code-statusbar">
      <button type="button" className="status-item" title="Language (syntax highlighting)" onClick={props.onLanguage} data-testid="status-language">
        {language}
      </button>
      <span className="status-item status-text" data-testid="status-size">
        Length: {state.doc.length.toLocaleString()} · Lines: {state.doc.lines.toLocaleString()}
      </span>
      <button type="button" className="status-item" title={`Go to line (${keyLabel(KEYS.goToLine)})`} onClick={props.onGoToLine} data-testid="status-position">
        {position}
        {selection}
      </button>
      <span className="spacer" />
      {recording && (
        <button type="button" className="status-item status-recording" title={`Stop recording (${keyLabel(KEYS.record)})`} onClick={props.onStopRecording} data-testid="status-recording">
          <Circle size={10} fill="currentColor" aria-hidden="true" /> Recording macro
        </button>
      )}
      {!editable && (
        <span className="status-item status-text" title="You can view but not edit this file">
          <Lock size={12} aria-hidden="true" /> Read-only
        </span>
      )}
      {editable ? (
        <>
          <StatusMenu text={indentation} title="Indentation" items={indentationItems} testId="status-indentation" />
          <StatusMenu text={EOL_LABELS[file.eol]} title="Line endings (used when downloading)" items={eolItems} testId="status-eol" />
          <StatusMenu text={ENCODING_LABELS[file.encoding]} title="Encoding (used when downloading)" items={encodingItems} testId="status-encoding" />
        </>
      ) : (
        <>
          <span className="status-item status-text">{indentation}</span>
          <span className="status-item status-text" title="Line endings (used when downloading)">
            {EOL_LABELS[file.eol]}
          </span>
          <span className="status-item status-text" title="Encoding (used when downloading)">
            {ENCODING_LABELS[file.encoding]}
          </span>
        </>
      )}
      <StatusMenu text={`${zoom}%`} title="Zoom" items={zoomItems} testId="status-zoom" />
    </footer>
  );
}
