import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Line spacing for the selected paragraphs, e.g. `'1.5'`; `null` resets it. */
      setLineHeight: (lineHeight: string | null) => ReturnType;
      /** Indents the selected paragraphs, or nests the current list item one level deeper. */
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export const MAX_INDENT = 8;
/** Each indent level is half an inch, like Word and Google Docs. */
export const INDENT_STEP_IN = 0.5;
const TYPES = ['paragraph', 'heading'];

const parseIndent = (element: HTMLElement): number => {
  const level = Number(element.getAttribute('data-indent'));
  if (level > 0) return Math.min(MAX_INDENT, Math.round(level));
  // Imported HTML (e.g. from Word) uses margins: 48px = 0.5in.
  const margin = parseFloat(element.style.marginLeft);
  if (!margin) return 0;
  const unit = element.style.marginLeft.replace(/[\d.\s-]/g, '');
  const inches = unit === 'in' ? margin : unit === 'pt' ? margin / 72 : unit === 'cm' ? margin / 2.54 : margin / 96;
  return Math.max(0, Math.min(MAX_INDENT, Math.round(inches / INDENT_STEP_IN)));
};

const adjustIndent =
  (delta: number) =>
  ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: unknown }): boolean => {
    let changed = false;
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
      if (!TYPES.includes(node.type.name)) return true;
      const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta));
      if (indent !== node.attrs.indent) {
        changed = true;
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
      }
      return false;
    });
    return changed;
  };

/** The innermost list item around the selection, if any. */
function listItemType(state: EditorState): 'listItem' | 'taskItem' | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'listItem' || name === 'taskItem') return name;
  }
  return null;
}

/** Paragraph-level line spacing and indentation (Format ▸ Align & indent / Line spacing). */
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => (attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {}),
          },
          indent: {
            default: 0,
            parseHTML: parseIndent,
            renderHTML: (attributes) =>
              attributes.indent
                ? { 'data-indent': attributes.indent, style: `margin-left: ${attributes.indent * INDENT_STEP_IN}in` }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight) =>
        ({ commands }) =>
          TYPES.map((type) => commands.updateAttributes(type, { lineHeight })).some(Boolean),
      indent:
        () =>
        ({ commands, ...props }) => {
          const list = listItemType(props.state);
          return list ? commands.sinkListItem(list) : adjustIndent(1)(props);
        },
      outdent:
        () =>
        ({ commands, ...props }) => {
          const list = listItemType(props.state);
          return list ? commands.liftListItem(list) : adjustIndent(-1)(props);
        },
    };
  },

  addKeyboardShortcuts() {
    // Lists, tables and code blocks have their own Tab behaviour.
    const handledElsewhere = () =>
      ['listItem', 'taskItem', 'table', 'codeBlock'].some((name) => this.editor.isActive(name));
    return {
      Tab: () => {
        if (handledElsewhere()) return false;
        const { selection } = this.editor.state;
        const atStart = selection.empty && selection instanceof TextSelection && selection.$from.parentOffset === 0;
        // Like Google Docs: indent the paragraph at its start or across a selection, otherwise type a tab.
        if (!selection.empty || atStart) return this.editor.commands.indent() || true;
        return this.editor.commands.insertContent('\t');
      },
      'Shift-Tab': () => {
        if (handledElsewhere()) return false;
        this.editor.commands.outdent();
        return true;
      },
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});
