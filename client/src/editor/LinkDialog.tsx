import { useState, type FormEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Dialog } from '../components/Dialog';

/**
 * Turns what the user typed into a link target: adds https:// to bare domains and mailto: to e-mail
 * addresses. Returns null for empty input and for schemes other than web, mail and phone links.
 */
export function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^[#/?]/.test(value)) return value;
  if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(value)) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
  if (/\s/.test(value)) return null;
  return `https://${value}`;
}

/** Selects the whole link around the cursor so that it can be edited (call before opening the dialog). */
export function selectLink(editor: Editor): void {
  if (editor.isActive('link')) editor.chain().extendMarkRange('link').run();
}

/** Insert ▸ Link: adds, edits or removes a link on the selection. */
export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [initial] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    return {
      href: String(editor.getAttributes('link').href ?? ''),
      text: empty ? '' : editor.state.doc.textBetween(from, to, ' '),
      existing: editor.isActive('link'),
    };
  });
  const [text, setText] = useState(initial.text);
  const [url, setUrl] = useState(initial.href);
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const href = normalizeUrl(url);
    if (!href) {
      setError('Enter a web address (like example.com), an e-mail address, or a link starting with # or /.');
      return;
    }
    // The dialog is modal, so the editor selection is still the one the dialog was opened for
    // (collaborators' edits move it along with the text).
    const { from, to, empty } = editor.state.selection;
    const label = text.trim();
    if (empty || (label && label !== initial.text)) {
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, { type: 'text', text: label || href, marks: [{ type: 'link', attrs: { href } }] })
        .unsetMark('link')
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  };

  return (
    <Dialog title={initial.existing ? 'Edit link' : 'Insert link'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Text</span>
          <input value={text} placeholder="Text to display" onChange={(event) => setText(event.target.value)} autoFocus={!initial.text} />
        </label>
        <label className="field">
          <span>Link</span>
          <input
            value={url}
            placeholder="Paste or type a link"
            autoFocus={!!initial.text}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
            aria-invalid={!!error}
            data-testid="link-url"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {initial.existing && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Remove link
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
}
