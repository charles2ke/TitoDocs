import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { X } from 'lucide-react';
import { getHeadings, goToPosition } from '../editor/table-of-contents';

/** View ▸ Show outline: the document's headings; click one to jump to it. */
export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { headings, current } = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const list = getHeadings(instance);
      const cursor = instance.state.selection.from;
      let currentPos = -1;
      for (const heading of list) if (heading.pos < cursor) currentPos = heading.pos;
      return { headings: list, current: currentPos };
    },
  });
  const minLevel = Math.min(...headings.map((heading) => heading.level), 6);
  return (
    <nav className="outline-panel no-print" aria-label="Document outline" data-testid="outline-panel">
      <div className="outline-header">
        <h2>Outline</h2>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Close outline" title="Close outline" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {headings.length ? (
        <ul>
          {headings.map((heading) => (
            <li key={heading.pos} style={{ paddingLeft: (heading.level - minLevel) * 14 }}>
              <button
                type="button"
                className={heading.pos === current ? 'current' : ''}
                aria-current={heading.pos === current ? 'location' : undefined}
                onClick={() => goToPosition(editor, heading.pos)}
                title={heading.text}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="outline-empty">Headings you add to the document will appear here.</p>
      )}
    </nav>
  );
}
