import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import InvisibleCharacters from '@tiptap/extension-invisible-characters';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import FileHandler from '@tiptap/extension-file-handler';
import { Plugin, PluginKey, Selection as ProseMirrorSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { RICH_FIELD } from '@shared/types';
import { api } from '../api';
import type { AwarenessUser, Room } from '../collab';
import { pickFile } from '../lib/util';
import { Comments, type ThreadsMap } from './comments';
import { FindReplace } from './find-replace';
import { PageBreak } from './page-break';
import { ParagraphFormat } from './paragraph-format';
import { ReadOnlySelection } from './read-only-selection';
import { SlashCommands, UserMention, type SlashItem } from './suggestions';
import { TableOfContents } from './table-of-contents';

export const lowlight = createLowlight(common);

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

type ImageAnchor = { from: number; to: number };
type ImageAnchorMeta = { add?: { id: string; anchor: ImageAnchor }; remove?: string[]; set?: { id: string; anchor: ImageAnchor } };

const imageAnchorsKey = new PluginKey<Map<string, ImageAnchor>>('imageUploadAnchors');
const imageAnchorsPlugin = new Plugin({
  key: imageAnchorsKey,
  state: {
    init: () => new Map<string, ImageAnchor>(),
    apply(transaction, previous) {
      const anchors = new Map(
        [...previous].map(([id, anchor]) => [
          id,
          {
            from: transaction.mapping.map(anchor.from, 1),
            to: transaction.mapping.map(anchor.to, 1),
          },
        ]),
      );
      const meta = transaction.getMeta(imageAnchorsKey) as ImageAnchorMeta | undefined;
      for (const id of meta?.remove ?? []) anchors.delete(id);
      if (meta?.add) anchors.set(meta.add.id, meta.add.anchor);
      if (meta?.set) anchors.set(meta.set.id, meta.set.anchor);
      return anchors;
    },
  },
});
const ImageUploadAnchors = Extension.create({
  name: 'imageUploadAnchors',
  addProseMirrorPlugins: () => [imageAnchorsPlugin],
});

export interface EditorSetup {
  room: Room;
  user: AwarenessUser;
  placeholder: string;
  /** Comment threads (documents only). */
  threads?: ThreadsMap | null;
  onActivateComment?: (threadId: string) => void;
  slashItems?: (editor: Editor) => SlashItem[];
  onError?: (error: unknown) => void;
  /** Extra extensions, e.g. embedded Loop components. */
  extra?: AnyExtension[];
}

/** Uploads pasted or dropped images and inserts them at their mapped document position. */
export async function insertImages(editor: Editor, files: File[], pos: number | null, onError?: (error: unknown) => void) {
  const id = crypto.randomUUID();
  const selection = editor.state.selection;
  const from = pos ?? selection.from;
  const to = pos === null ? selection.to : pos;
  editor.view.dispatch(editor.state.tr.setMeta(imageAnchorsKey, { add: { id, anchor: { from, to } } }));
  try {
    for (const file of files) {
      try {
        const src = await api.upload(file);
        if (editor.isDestroyed) break;
        const anchor = imageAnchorsKey.getState(editor.state)?.get(id);
        if (!anchor) break;
        const image = editor.schema.nodes.image.create({
          src,
          alt: file.name.replace(/\.[^.]+$/, ''),
        });
        const nextPosition = anchor.from + image.nodeSize;
        const transaction = editor.state.tr.replaceRangeWith(anchor.from, anchor.to, image);
        transaction.setSelection(ProseMirrorSelection.near(transaction.doc.resolve(nextPosition), 1));
        editor.view.dispatch(transaction);
        editor.view.focus();
        editor.view.dispatch(
          editor.state.tr.setMeta(imageAnchorsKey, { set: { id, anchor: { from: nextPosition, to: nextPosition } } }),
        );
      } catch (error) {
        onError?.(error);
      }
    }
  } finally {
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(imageAnchorsKey, { remove: [id] }));
    }
  }
}

/** Opens the file picker and inserts the chosen image at the cursor. */
export async function pickImage(editor: Editor, onError: (error: unknown) => void): Promise<void> {
  const image = await pickFile(IMAGE_TYPES.join(','));
  if (!image) return;
  if (!IMAGE_TYPES.includes(image.type)) {
    onError(new Error('Choose a PNG, JPEG, GIF or WebP image.'));
    return;
  }
  await insertImages(editor, [image], null, onError);
}

/** Extensions that define the content schema and formatting (and read-only selection), without collaboration or editing UI. */
export function contentExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({
      // Yjs provides collaborative undo history.
      undoRedo: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
      dropcursor: { color: '#1a73e8', width: 2 },
    }),
    TextStyleKit.configure({ lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    Typography,
    Image.configure({
      allowBase64: false,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 40, minHeight: 40 },
    }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight, enableTabIndentation: true, tabSize: 2 }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    ParagraphFormat,
    PageBreak,
    TableOfContents,
    UserMention,
    ReadOnlySelection,
    ...extra,
  ];
}

export function buildExtensions(setup: EditorSetup): AnyExtension[] {
  return [
    ...contentExtensions(setup.extra),
    ImageUploadAnchors,
    CharacterCount,
    Placeholder.configure({ placeholder: setup.placeholder, includeChildren: false }),
    Selection,
    InvisibleCharacters.configure({ visible: false }),
    FindReplace,
    SlashCommands.configure({ items: setup.slashItems ?? (() => []) }),
    Comments.configure({ threads: setup.threads ?? null, onActivate: setup.onActivateComment ?? (() => {}) }),
    Collaboration.configure({ document: setup.room.doc, field: RICH_FIELD }),
    CollaborationCaret.configure({ provider: setup.room.provider, user: setup.user }),
    FileHandler.configure({
      allowedMimeTypes: IMAGE_TYPES,
      onPaste: (editor, files) => void insertImages(editor, files, null, setup.onError),
      onDrop: (editor, files, pos) => void insertImages(editor, files, pos, setup.onError),
    }),
  ];
}
