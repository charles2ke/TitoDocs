import { use, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useUser } from '../auth';
import { toAwarenessUser } from '../collab';
import { useToast } from '../components/Toast';
import { LinkBubble, TableBubble, TextBubble } from '../editor/EditorBubbles';
import { buildExtensions, pickImage } from '../editor/extensions';
import { LinkDialog, selectLink } from '../editor/LinkDialog';
import { basicSlashItems } from '../editor/slashItems';
import { isMac, keyName } from '../lib/util';
import { LoopContext } from './context';
import type { ComponentViewProps } from './rows';

/** Live rich text, edited in its own editor wherever the component is shown (like a Loop paragraph). */
export function RichView({ room, editable, autoFocus, onAutoFocused, variant }: ComponentViewProps) {
  const user = useUser();
  const toast = useToast();
  const { scrollEl } = use(LoopContext);
  const [linkOpen, setLinkOpen] = useState(false);
  const [awarenessUser] = useState(() => toAwarenessUser(user));
  const extensions = useMemo(
    () =>
      buildExtensions({
        room,
        user: awarenessUser,
        placeholder: 'Type “/” for commands',
        slashItems: () => basicSlashItems({ onImage: (target) => void pickImage(target, toast.error) }),
        onError: toast.error,
      }),
    [room, awarenessUser, toast],
  );
  const editor = useEditor(
    {
      extensions,
      editable: false,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { 'aria-label': 'Component content' } },
    },
    [extensions],
  );

  useEffect(() => {
    if (!editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  const focusEditor = useEffectEvent(() => {
    onAutoFocused();
    editor.commands.focus('end');
  });
  useEffect(() => {
    if (autoFocus && editable) focusEditor();
  }, [autoFocus, editable]);

  const openLink = () => {
    if (!editor.isEditable) return;
    selectLink(editor);
    setLinkOpen(true);
  };

  return (
    <div
      className={`loop-rich loop-rich-${variant}`}
      onKeyDown={(event) => {
        if (!(isMac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey || keyName(event.nativeEvent) !== 'k') return;
        if (!editor.view.dom.contains(event.target as Node)) return;
        event.preventDefault();
        openLink();
      }}
    >
      <EditorContent editor={editor} className="loop-rich-content" />
      <TextBubble editor={editor} container={null} scrollTarget={scrollEl} canComment={false} onComment={() => {}} onLink={openLink} />
      <LinkBubble editor={editor} container={null} scrollTarget={scrollEl} onEdit={openLink} />
      <TableBubble editor={editor} container={null} scrollTarget={scrollEl} />
      {linkOpen && (
        <LinkDialog
          editor={editor}
          onClose={() => {
            setLinkOpen(false);
            requestAnimationFrame(() => editor.commands.focus());
          }}
        />
      )}
    </div>
  );
}
