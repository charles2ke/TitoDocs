import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type ReactNodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

export interface HeadingEntry {
  level: number;
  text: string;
  pos: number;
}

/** Headings of the document, for the outline and tables of contents. */
export function getHeadings(editor: Editor): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (text) headings.push({ level: node.attrs.level as number, text, pos });
      return false;
    }
    // Headings only appear at the top level or inside containers such as details/columns.
    return !node.isTextblock;
  });
  return headings;
}

/** Moves the cursor to a heading and scrolls it into view. */
export function goToPosition(editor: Editor, pos: number): void {
  const { state, view } = editor;
  if (pos > state.doc.content.size) return;
  const selection = TextSelection.near(state.doc.resolve(Math.min(pos + 1, state.doc.content.size)));
  view.dispatch(state.tr.setSelection(selection));
  const element = view.nodeDOM(pos);
  if (element instanceof HTMLElement) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  view.focus();
}

function TableOfContentsView({ editor }: ReactNodeViewProps) {
  const headings = useEditorState({ editor, selector: ({ editor: current }) => getHeadings(current) });
  return (
    <NodeViewWrapper className="toc" data-type="table-of-contents" contentEditable={false}>
      <div className="toc-title">Table of contents</div>
      {headings.length === 0 ? (
        <p className="toc-empty">Add headings (Format ▸ Paragraph styles) and they will appear here.</p>
      ) : (
        <ol className="toc-list">
          {headings.map((heading, index) => (
            <li key={`${heading.pos}-${index}`} className={`toc-level-${heading.level}`}>
              <a
                href={`#heading-${index}`}
                onClick={(event) => {
                  event.preventDefault();
                  goToPosition(editor, heading.pos);
                }}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

/** A live table of contents built from the document's headings. */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents', class: 'toc' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name }).run(),
    };
  },
});
