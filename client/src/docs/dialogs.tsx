import { useEffect, useState, type FormEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Dialog } from '../components/Dialog';
import type { ShortcutGroup } from '../components/ShortcutsDialog';
import { DEFAULT_PAGE_SETUP, PAGE_SIZES, type Margins, type PageSetup, type PageSize } from './pageSetup';

// ------------------------------------------------------------------ word count

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

export function countText(text: string): TextStats {
  const withoutBreaks = text.replace(/\n/g, '');
  return {
    words: text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
    characters: [...withoutBreaks].length,
    charactersNoSpaces: [...withoutBreaks.replace(/\s/g, '')].length,
  };
}

const documentText = (editor: Editor, from = 0, to = editor.state.doc.content.size): string =>
  editor.state.doc.textBetween(from, to, '\n', ' ');

/** Word and character counts of the document and of the selection (updated shortly after changes). */
export function useTextStats(editor: Editor | null): { document: TextStats; selection: TextStats | null } {
  const empty: TextStats = { words: 0, characters: 0, charactersNoSpaces: 0 };
  const [stats, setStats] = useState<{ document: TextStats; selection: TextStats | null }>({ document: empty, selection: null });
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (editor.isDestroyed) return;
      const { from, to, empty: collapsed } = editor.state.selection;
      setStats({ document: countText(documentText(editor)), selection: collapsed ? null : countText(documentText(editor, from, to)) });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 250);
    };
    update();
    editor.on('update', schedule);
    editor.on('selectionUpdate', schedule);
    return () => {
      clearTimeout(timer);
      editor.off('update', schedule);
      editor.off('selectionUpdate', schedule);
    };
  }, [editor]);
  return stats;
}

interface WordCountProps {
  editor: Editor;
  showWhileTyping: boolean;
  onShowWhileTyping: (show: boolean) => void;
  onClose: () => void;
}

export function WordCountDialog({ editor, showWhileTyping, onShowWhileTyping, onClose }: WordCountProps) {
  const [stats] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    return { document: countText(documentText(editor)), selection: empty ? null : countText(documentText(editor, from, to)) };
  });
  const row = (label: string, key: keyof TextStats) => (
    <tr>
      <th scope="row">{label}</th>
      <td>{stats.selection ? `${stats.selection[key].toLocaleString()} of ${stats.document[key].toLocaleString()}` : stats.document[key].toLocaleString()}</td>
    </tr>
  );
  return (
    <Dialog title="Word count" onClose={onClose}>
      <table className="stats-table" data-testid="word-count">
        <tbody>
          {row('Words', 'words')}
          {row('Characters', 'characters')}
          {row('Characters excluding spaces', 'charactersNoSpaces')}
        </tbody>
      </table>
      <label className="checkbox-field">
        <input type="checkbox" checked={showWhileTyping} onChange={(event) => onShowWhileTyping(event.target.checked)} />
        Display word count while typing
      </label>
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={onClose}>
          OK
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ page setup

interface PageSetupProps {
  setup: PageSetup;
  onApply: (setup: PageSetup) => void;
  onClose: () => void;
}

const MARGIN_LABELS: [keyof Margins, string][] = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
];

export function PageSetupDialog({ setup, onApply, onClose }: PageSetupProps) {
  const [draft, setDraft] = useState(setup);
  const [margins, setMargins] = useState(() =>
    Object.fromEntries(Object.entries(setup.margins).map(([side, value]) => [side, String(value)])) as Record<keyof Margins, string>,
  );
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = {} as Margins;
    for (const [side, label] of MARGIN_LABELS) {
      const value = Number(margins[side].replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > 3) {
        setError(`${label} margin must be between 0 and 3 inches.`);
        return;
      }
      parsed[side] = Math.round(value * 100) / 100;
    }
    onApply({ ...draft, margins: parsed });
    onClose();
  };

  return (
    <Dialog title="Page setup" onClose={onClose}>
      <form className="form page-setup" onSubmit={submit} data-testid="page-setup">
        <fieldset className="segmented">
          <legend>Format</legend>
          <label>
            <input type="radio" name="format" checked={!draft.pageless} onChange={() => setDraft({ ...draft, pageless: false })} />
            Pages
          </label>
          <label>
            <input type="radio" name="format" checked={draft.pageless} onChange={() => setDraft({ ...draft, pageless: true })} />
            Pageless
          </label>
        </fieldset>
        <fieldset className="segmented">
          <legend>Orientation</legend>
          <label>
            <input type="radio" name="orientation" checked={draft.orientation === 'portrait'} onChange={() => setDraft({ ...draft, orientation: 'portrait' })} />
            Portrait
          </label>
          <label>
            <input
              type="radio"
              name="orientation"
              checked={draft.orientation === 'landscape'}
              onChange={() => setDraft({ ...draft, orientation: 'landscape' })}
            />
            Landscape
          </label>
        </fieldset>
        <label className="field">
          <span>Paper size</span>
          <select value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value as PageSize })}>
            {Object.entries(PAGE_SIZES).map(([value, size]) => (
              <option key={value} value={value}>
                {size.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="margins">
          <legend>Margins (inches)</legend>
          {MARGIN_LABELS.map(([side, label]) => (
            <label key={side} className="field">
              <span>{label}</span>
              <input
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={margins[side]}
                onChange={(event) => {
                  setMargins({ ...margins, [side]: event.target.value });
                  setError('');
                }}
                data-testid={`margin-${side}`}
              />
            </label>
          ))}
        </fieldset>
        <label className="checkbox-field">
          <input type="checkbox" checked={draft.pageNumbers} onChange={(event) => setDraft({ ...draft, pageNumbers: event.target.checked })} />
          Page numbers when printing and in Word downloads
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(DEFAULT_PAGE_SETUP);
              setMargins(
                Object.fromEntries(Object.entries(DEFAULT_PAGE_SETUP.margins).map(([side, value]) => [side, String(value)])) as Record<
                  keyof Margins,
                  string
                >,
              );
            }}
          >
            Reset
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ keyboard shortcuts

export const DOC_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Common actions',
    items: [
      ['Undo', 'Mod-z'],
      ['Redo', 'Mod-Shift-z'],
      ['Find', 'Mod-f'],
      ['Find and replace', 'Mod-h'],
      ['Print', 'Mod-p'],
      ['Insert link', 'Mod-k'],
      ['Insert comment', 'Mod-Alt-m'],
      ['Insert page break', 'Mod-Enter'],
      ['Keyboard shortcuts', 'Mod-/'],
      ['Word count', 'Mod-Shift-c'],
      ['Version history', 'Mod-Alt-Shift-h'],
      ['Show non-printing characters', 'Mod-Shift-p'],
      ['Commands menu (type at the start of a line)', '/'],
      ['Mention a person', '@'],
    ],
  },
  {
    title: 'Text formatting',
    items: [
      ['Bold', 'Mod-b'],
      ['Italic', 'Mod-i'],
      ['Underline', 'Mod-u'],
      ['Strikethrough', 'Mod-Shift-s'],
      ['Inline code', 'Mod-e'],
      ['Superscript', 'Mod-.'],
      ['Subscript', 'Mod-,'],
      ['Highlight', 'Mod-Shift-h'],
      ['Increase font size', 'Mod-Shift-.'],
      ['Decrease font size', 'Mod-Shift-,'],
      ['Clear formatting', 'Mod-\\'],
    ],
  },
  {
    title: 'Paragraph formatting',
    items: [
      ['Normal text', 'Mod-Alt-0'],
      ['Heading 1 – 6', 'Mod-Alt-1'],
      ['Left align', 'Mod-Shift-l'],
      ['Center align', 'Mod-Shift-e'],
      ['Right align', 'Mod-Shift-r'],
      ['Justify', 'Mod-Shift-j'],
      ['Numbered list', 'Mod-Shift-7'],
      ['Bulleted list', 'Mod-Shift-8'],
      ['Checklist', 'Mod-Shift-9'],
      ['Increase indent', 'Mod-]'],
      ['Decrease indent', 'Mod-['],
      ['Code block', 'Mod-Alt-c'],
      ['Quote', 'Mod-Shift-b'],
    ],
  },
];

// ------------------------------------------------------------------ special characters

const SPECIAL_CHARACTERS: Record<string, string> = {
  Symbols: '©®™§¶†‡•…‰′″°№℃℉✓✗☐☑★☆♠♣♥♦',
  Punctuation: '–—‘’“”‚„«»‹›¡¿·¦‽',
  Arrows: '←→↑↓↔↕⇐⇒⇑⇓⇔↩↪⟵⟶➜',
  Math: '±×÷≠≈≡≤≥∞√∛∑∏∫∂∆∇∈∉∩∪⊂⊃∧∨¬∀∃∅πµ½⅓¼¾²³¹',
  Currency: '$€£¥¢₹₽₩₪₫₱₴₦₿',
  Greek: 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ',
  Emoji: '😀😂😊😍🤔😎😢👍👎👏🙌🙏🎉✅❌⚠️⭐🔥💡📌📅📎✏️🚀❤️',
};

interface SpecialCharactersProps {
  onInsert: (character: string) => void;
  onClose: () => void;
}

export function SpecialCharactersDialog({ onInsert, onClose }: SpecialCharactersProps) {
  const categories = Object.keys(SPECIAL_CHARACTERS);
  const [category, setCategory] = useState(categories[0]!);
  // Split into user-perceived characters so that emoji with variation selectors stay whole.
  const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(SPECIAL_CHARACTERS[category]!)].map(
    (part) => part.segment,
  );
  return (
    <Dialog title="Special characters" onClose={onClose}>
      <label className="field">
        <span>Category</span>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <div className="char-grid" role="group" aria-label={category} data-testid="special-characters">
        {characters.map((character) => (
          <button
            key={character}
            type="button"
            className="char-btn"
            title={`Insert ${character} (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`}
            onClick={() => onInsert(character)}
          >
            {character}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
