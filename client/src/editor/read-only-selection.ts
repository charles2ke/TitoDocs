import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Lets people select (and so copy or comment on) text in an editor they cannot edit.
 *
 * ProseMirror draws mouse selections itself, but only shows them in a read-only editor when the browser's selection is
 * already inside it, which a click never achieves because ProseMirror cancels the browser's own handling. Moving the
 * browser selection to the clicked spot first lets ProseMirror take over from there.
 */
export const ReadOnlySelection = Extension.create({
  name: 'readOnlySelection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('readOnlySelection'),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (view.editable || event.button !== 0) return false;
              if (event.target instanceof Element && event.target.closest('input, textarea, select, button')) return false;
              const selection = view.dom.ownerDocument.getSelection();
              if (!selection || (selection.anchorNode && view.dom.contains(selection.anchorNode))) return false;
              const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!found) return false;
              const { node, offset } = view.domAtPos(found.pos);
              selection.collapse(node, offset);
              return false;
            },
          },
        },
      }),
    ];
  },
});
