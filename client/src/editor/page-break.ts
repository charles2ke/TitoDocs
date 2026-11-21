import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

/** A manual page break: shown as a divider on screen and honoured when printing or exporting. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  // Run before HardBreak so Ctrl+Enter inserts a page break, as in Word and Google Docs.
  priority: 110,

  parseHTML() {
    return [
      { tag: 'div[data-type="page-break"]' },
      {
        // HTML saved from Word marks page breaks with CSS.
        tag: 'br',
        getAttrs: (element) =>
          /page-break-before:\s*always|break-before:\s*page/i.test(element.getAttribute('style') ?? '') ? {} : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'page-break' })];
  },

  renderText() {
    return '\n';
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name }).run(),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});
