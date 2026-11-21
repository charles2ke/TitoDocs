import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { use } from 'react';
import type { ComponentType } from '@shared/types';
import { useToast } from '../components/Toast';
import { absoluteUrl } from '../lib/util';
import { ComponentCard } from './ComponentCard';
import { componentInfo } from './componentTypes';
import { LoopContext } from './context';

export interface LoopComponentAttrs {
  id: string;
  type?: ComponentType | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    loopComponent: {
      /** Inserts a live Loop component at `position` (default: the selection). */
      insertLoopComponent: (attrs: LoopComponentAttrs, position?: number) => ReturnType;
    };
  }
}

export interface LoopComponentOptions {
  /** Shows plain links instead of live components (for version previews). */
  preview: boolean;
}

const NODE_CLASS = 'loop-node';
const LINK = /^(https?:\/\/[^/\s]+)\/c\/([A-Za-z0-9_-]{6,64})\/?(?:[?#]\S*)?$/;

/** The component id when `text` is a link to a Loop component on this site. */
export function componentIdFromLink(text: string): string | null {
  const match = LINK.exec(text.trim());
  return match && match[1] === window.location.origin ? match[2] : null;
}

const componentUrl = (id: unknown): string => absoluteUrl(`/c/${String(id)}`);

function closestInNode(start: Element, selector: string): Element | null {
  for (let element: Element | null = start; element && !element.classList.contains(NODE_CLASS); element = element.parentElement) {
    if (element.matches(selector)) return element;
  }
  return null;
}

/**
 * Which events the page editor must leave to the card. Its fields, buttons and nested editor handle their own events;
 * the rest of the card (its border and the blank part of its header) behaves like any other block, so clicking it
 * selects the card for copying, deleting or moving it.
 */
function stopEvent({ event }: { event: Event }): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const textTarget = !!closestInNode(target, 'input, textarea') || (target instanceof HTMLElement && target.isContentEditable);
  if (event.type === 'dragstart') return !!closestInNode(target, '[data-loop-interactive]');
  if (event.type === 'dragover' || event.type === 'dragenter' || event.type === 'drop') return textTarget;
  if (event.type.startsWith('drag')) return false;
  if (textTarget || closestInNode(target, 'select, button, a, label, [data-loop-interactive]')) return true;
  return !['copy', 'cut', 'paste', 'mousedown'].includes(event.type);
}

function LoopComponentView({ node, editor, getPos, selected }: ReactNodeViewProps) {
  const { pageEditable } = use(LoopContext);
  const toast = useToast();
  const id = typeof node.attrs.id === 'string' && node.attrs.id ? node.attrs.id : null;

  const remove = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const attrs = { ...node.attrs };
    editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
    toast.show('Removed the component from this page. Copies of it on other pages are not affected.', {
      action: {
        label: 'Undo',
        onClick: () => {
          if (!editor.isDestroyed) editor.chain().insertContentAt(Math.min(pos, editor.state.doc.content.size), { type: node.type.name, attrs }).run();
        },
      },
    });
  };

  // Pasted links do not say which kind of component they point to; record it once the component has loaded.
  const setType = (type: ComponentType) => {
    const pos = getPos();
    if (type === node.attrs.type || !editor.isEditable || typeof pos !== 'number') return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'type', type).setMeta('addToHistory', false));
  };

  return (
    <NodeViewWrapper className="loop-embed" data-loop-component="" data-component-id={id ?? undefined}>
      {id ? (
        <ComponentCard key={id} id={id} selected={selected} readOnly={!pageEditable} onRemove={pageEditable ? remove : undefined} onType={setType} />
      ) : (
        <div className="loop-card loop-card-message" role="note">
          This Loop component link is incomplete.
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** A live Loop component (task list, voting table, …) embedded in a page. Its content lives in its own file. */
export const LoopComponent = Node.create<LoopComponentOptions>({
  name: 'loopComponent',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  // Before the link extension, so pasting a component link embeds the component.
  priority: 150,

  addOptions() {
    return { preview: false };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-component-id'),
        renderHTML: (attributes) => ({ 'data-component-id': attributes.id }),
      },
      type: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-component-type'),
        renderHTML: (attributes) => (attributes.type ? { 'data-component-type': attributes.type } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-loop-component]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.type ? `${componentInfo(node.attrs.type).label} (Loop component)` : 'Loop component';
    return ['div', mergeAttributes(HTMLAttributes, { 'data-loop-component': '', class: 'loop-embed-link' }), ['a', { href: componentUrl(node.attrs.id) }, label]];
  },

  renderText({ node }) {
    return componentUrl(node.attrs.id);
  },

  addNodeView() {
    if (this.options.preview) return null;
    return ReactNodeViewRenderer(LoopComponentView, { className: NODE_CLASS, stopEvent });
  },

  addCommands() {
    return {
      insertLoopComponent:
        (attrs, position) =>
        ({ commands, state }) =>
          commands.insertContentAt(position ?? { from: state.selection.from, to: state.selection.to }, { type: this.name, attrs }),
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('loopComponentPaste'),
        props: {
          // A component link pasted on an empty line becomes the live component (as in Loop).
          handlePaste: (view, event) => {
            const id = componentIdFromLink(event.clipboardData?.getData('text/plain') ?? '');
            const { selection } = view.state;
            const { $from } = selection;
            if (!id || !selection.empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
            view.dispatch(view.state.tr.replaceRangeWith($from.before(), $from.after(), type.create({ id })).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
