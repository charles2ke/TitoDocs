import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Code,
  Copy,
  EllipsisVertical,
  Italic,
  Link,
  MessageSquarePlus,
  Pencil,
  Strikethrough,
  Trash2,
  Underline,
  Unlink,
} from 'lucide-react';
import { Dropdown } from '../components/Menu';
import { useToast } from '../components/Toast';
import { shortcut } from '../lib/util';

interface ShouldShowProps {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}

interface FloatingProps {
  editor: Editor;
  /** Element the menus are placed in: outside the zoomed page, so positions are not scaled. */
  container: HTMLElement | null;
  /** The scrolling element around the editor (menus follow it). */
  scrollTarget: HTMLElement | null;
}

/** Only web, mail and phone links (and in-page anchors) are rendered as clickable links. */
export const isSafeHref = (href: string): boolean => /^(https?:|mailto:|tel:|#|\/(?!\/))/i.test(href.trim());

function useFloating(
  { editor, container, scrollTarget }: FloatingProps,
  pluginKey: string,
  placement: 'top' | 'top-start' | 'bottom' = 'top',
) {
  const appendTo = useCallback(() => container ?? document.body, [container]);
  const options = useMemo(
    () => ({
      strategy: 'fixed' as const,
      placement,
      offset: 8,
      flip: true,
      shift: { padding: 8 },
      // Hide the menu while its target is scrolled out of the editing area (rather than float over the toolbar).
      hide: scrollTarget ? { boundary: scrollTarget } : false,
      scrollTarget: scrollTarget ?? window,
    }),
    [scrollTarget, placement],
  );
  // TipTap ignores the first blur after any click inside a menu, which left the menu showing when focus then moved
  // elsewhere (for example into the comments panel); hide it whenever focus leaves the editor and its menus.
  useEffect(() => {
    const onBlur = ({ event }: { event: FocusEvent }) => {
      const next = event.relatedTarget;
      if (next instanceof Element && (next.closest('.bubble-menu') || editor.view.dom.contains(next))) return;
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(pluginKey, 'hide'));
    };
    editor.on('blur', onBlur);
    return () => {
      editor.off('blur', onBlur);
    };
  }, [editor, pluginKey]);
  return { appendTo, options };
}

const hasFocus = ({ view, element }: Pick<ShouldShowProps, 'view' | 'element'>): boolean =>
  view.hasFocus() || element.contains(document.activeElement);

/** True when the user has selected text in a read-only editor (which cannot take focus). */
function hasReadOnlySelection(view: EditorView): boolean {
  const selection = view.dom.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && view.dom.contains(selection.anchorNode);
}

function BubbleButton({
  label,
  keys,
  icon,
  active,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  keys?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={keys ? `${label} (${shortcut(keys)})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}

interface TextBubbleProps extends FloatingProps {
  canComment: boolean;
  onComment: () => void;
  onLink: () => void;
}

/** Formatting and comment buttons shown above selected text. */
export function TextBubble({ editor, container, scrollTarget, canComment, onComment, onLink }: TextBubbleProps) {
  const floating = useFloating({ editor, container, scrollTarget }, 'textBubble');
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      link: current.isActive('link'),
    }),
  });
  const shouldShow = useCallback(
    ({ editor: current, view, state: editorState, from, to, element }: ShouldShowProps) => {
      if (!(editorState.selection instanceof TextSelection) || editorState.selection.empty) return false;
      if (!editorState.doc.textBetween(from, to, ' ').trim()) return false;
      if (current.isEditable) return hasFocus({ view, element });
      return canComment && hasReadOnlySelection(view);
    },
    [canComment],
  );
  const chain = () => editor.chain().focus();
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textBubble"
      shouldShow={shouldShow}
      updateDelay={120}
      appendTo={floating.appendTo}
      options={floating.options}
      className="bubble-menu"
      data-testid="text-bubble"
    >
      {state.editable && (
        <>
          <BubbleButton label="Bold" keys="Mod-b" icon={<Bold size={16} />} active={state.bold} onClick={() => chain().toggleBold().run()} />
          <BubbleButton label="Italic" keys="Mod-i" icon={<Italic size={16} />} active={state.italic} onClick={() => chain().toggleItalic().run()} />
          <BubbleButton
            label="Underline"
            keys="Mod-u"
            icon={<Underline size={16} />}
            active={state.underline}
            onClick={() => chain().toggleUnderline().run()}
          />
          <BubbleButton
            label="Strikethrough"
            keys="Mod-Shift-s"
            icon={<Strikethrough size={16} />}
            active={state.strike}
            onClick={() => chain().toggleStrike().run()}
          />
          <BubbleButton label="Inline code" keys="Mod-e" icon={<Code size={16} />} active={state.code} onClick={() => chain().toggleCode().run()} />
          <span className="bubble-menu-divider" />
          <BubbleButton label="Link" keys="Mod-k" icon={<Link size={16} />} active={state.link} onClick={onLink} />
        </>
      )}
      {canComment && (
        <BubbleButton label="Add comment" keys="Mod-Alt-m" icon={<MessageSquarePlus size={16} />} onClick={onComment} testId="bubble-comment" />
      )}
    </BubbleMenu>
  );
}

/** Shows where a link goes, with edit and remove buttons, when the cursor is inside a link. */
export function LinkBubble({ editor, container, scrollTarget, onEdit }: FloatingProps & { onEdit: () => void }) {
  const toast = useToast();
  const floating = useFloating({ editor, container, scrollTarget }, 'linkBubble', 'bottom');
  const href = useEditorState({
    editor,
    selector: ({ editor: current }) => (current.isActive('link') ? String(current.getAttributes('link').href ?? '') : ''),
  });
  const shouldShow = useCallback(
    ({ editor: current, view, state, element }: ShouldShowProps) =>
      state.selection.empty && current.isEditable && current.isActive('link') && hasFocus({ view, element }),
    [],
  );
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubble"
      shouldShow={shouldShow}
      appendTo={floating.appendTo}
      options={floating.options}
      className="bubble-menu link-bubble"
    >
      {isSafeHref(href) ? (
        <a className="link-bubble-url" href={href} target="_blank" rel="noopener noreferrer" title={href}>
          {href}
        </a>
      ) : (
        <span className="link-bubble-url" title={href}>
          {href}
        </span>
      )}
      <BubbleButton
        label="Copy link"
        icon={<Copy size={16} />}
        onClick={() => {
          navigator.clipboard?.writeText(href).then(
            () => toast.show('Link copied'),
            () => toast.show('Could not copy the link', { kind: 'error' }),
          );
        }}
      />
      <BubbleButton label="Edit link" icon={<Pencil size={16} />} onClick={onEdit} />
      <BubbleButton
        label="Remove link"
        icon={<Unlink size={16} />}
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
      />
    </BubbleMenu>
  );
}

/** Row, column and cell commands shown above the table that contains the cursor. */
export function TableBubble({ editor, container, scrollTarget }: FloatingProps) {
  const floating = useFloating({ editor, container, scrollTarget }, 'tableBubble', 'top-start');
  const shouldShow = useCallback(
    ({ editor: current, view, element }: ShouldShowProps) => current.isEditable && current.isActive('table') && hasFocus({ view, element }),
    [],
  );
  const getReferencedVirtualElement = useCallback(() => {
    const { state, view } = editor;
    const $pos = state.selection.$anchor;
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name !== 'table') continue;
      const dom = view.nodeDOM($pos.before(depth));
      const element = dom instanceof HTMLElement ? (dom.closest<HTMLElement>('.tableWrapper') ?? dom) : null;
      if (!element) return null;
      return { getBoundingClientRect: () => element.getBoundingClientRect(), getClientRects: () => element.getClientRects() };
    }
    return null;
  }, [editor]);
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => command(editor.chain().focus()).run();
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={shouldShow}
      getReferencedVirtualElement={getReferencedVirtualElement}
      appendTo={floating.appendTo}
      options={floating.options}
      className="bubble-menu table-bubble"
      data-testid="table-bubble"
    >
      <BubbleButton label="Insert row above" icon={<BetweenHorizontalStart size={16} />} onClick={() => run((c) => c.addRowBefore())} />
      <BubbleButton label="Insert row below" icon={<BetweenHorizontalEnd size={16} />} onClick={() => run((c) => c.addRowAfter())} />
      <BubbleButton label="Insert column left" icon={<BetweenVerticalStart size={16} />} onClick={() => run((c) => c.addColumnBefore())} />
      <BubbleButton label="Insert column right" icon={<BetweenVerticalEnd size={16} />} onClick={() => run((c) => c.addColumnAfter())} />
      <span className="bubble-menu-divider" />
      <Dropdown
        label="Table options"
        items={() => [
          { label: 'Delete row', onSelect: () => run((c) => c.deleteRow()) },
          { label: 'Delete column', onSelect: () => run((c) => c.deleteColumn()) },
          { type: 'separator' },
          { label: 'Merge cells', disabled: !editor.can().mergeCells(), onSelect: () => run((c) => c.mergeCells()) },
          { label: 'Split cell', disabled: !editor.can().splitCell(), onSelect: () => run((c) => c.splitCell()) },
          { type: 'separator' },
          { label: 'Header row', onSelect: () => run((c) => c.toggleHeaderRow()) },
          { label: 'Header column', onSelect: () => run((c) => c.toggleHeaderColumn()) },
        ]}
        trigger={(props) => (
          <button type="button" className="icon-btn" aria-label="More table options" title="More table options" {...props}>
            <EllipsisVertical size={16} />
          </button>
        )}
      />
      <BubbleButton label="Delete table" icon={<Trash2 size={16} />} onClick={() => run((c) => c.deleteTable())} />
    </BubbleMenu>
  );
}
