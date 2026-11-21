// Tools ▸ Compare: the file and another text side by side, with the differences highlighted.
import { useEffect, useRef, useState } from 'react';
import type { LanguageDescription } from '@codemirror/language';
import { goToNextChunk, goToPreviousChunk, MergeView } from '@codemirror/merge';
import { ArrowDown, ArrowLeftRight, ArrowUp, X } from 'lucide-react';
import { viewerExtensions, type FileSettings } from './editorSetup';
import type { CompareSource } from './dialogs';

interface CompareViewProps {
  /** The file, as it was when the comparison started. */
  current: CompareSource;
  other: CompareSource;
  language: LanguageDescription | null;
  file: FileSettings;
  dark: boolean;
  onClose: () => void;
}

export function CompareView({ current, other, language, file, dark, onClose }: CompareViewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [swapped, setSwapped] = useState(false);
  const [merge, setMerge] = useState<MergeView | null>(null);
  const [left, right] = swapped ? [other, current] : [current, other];

  useEffect(() => {
    const extensions = viewerExtensions({ dark, file, language });
    const view = new MergeView({
      a: { doc: left.text, extensions },
      b: { doc: right.text, extensions },
      parent: host.current!,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
    });
    setMerge(view);
    return () => view.destroy();
  }, [left, right, language, file, dark]);

  useEffect(() => {
    const element = dialog.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    closeButton.current?.focus();
    return () => {
      if (element?.open) element.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const differences = merge?.chunks.length ?? 0;
  const step = (forward: boolean) => {
    if (!merge) return;
    (forward ? goToNextChunk : goToPreviousChunk)(merge.b);
  };

  return (
    <dialog
      ref={dialog}
      className="compare-view"
      aria-label="Compare"
      data-testid="compare-view"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? index <= 0 : index === -1 || index === focusable.length - 1;
        if (next && focusable.length) {
          event.preventDefault();
          event.stopPropagation();
          focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="compare-toolbar">
        <strong>Compare</strong>
        <span className="muted" data-testid="compare-summary">
          {differences ? `${differences.toLocaleString()} ${differences === 1 ? 'difference' : 'differences'}` : 'The texts are identical'}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => step(false)} disabled={!differences}>
          <ArrowUp size={16} /> Previous
        </button>
        <button type="button" className="btn btn-sm" onClick={() => step(true)} disabled={!differences}>
          <ArrowDown size={16} /> Next
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSwapped((value) => !value)}>
          <ArrowLeftRight size={16} /> Swap sides
        </button>
        <span className="spacer" />
        <button ref={closeButton} type="button" className="icon-btn" aria-label="Close compare" title="Close (Escape)" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="compare-labels" aria-hidden="true">
        <span className="compare-label compare-label-a" title={left.label}>
          {left.label}
        </span>
        <span className="compare-label compare-label-b" title={right.label}>
          {right.label}
        </span>
      </div>
      <div className="compare-host" ref={host} aria-label={`${left.label} compared with ${right.label}`} />
    </dialog>
  );
}
