import { Extension, type AnyExtension, type Editor, type JSONContent } from '@tiptap/core';
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
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
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

type DocRange = { from: number; to: number };
/** Where uploading images will go, and where the cursor was when they were added. Both follow later edits. */
type ImageAnchor = { at: DocRange; cursor: DocRange };
type ImageAnchorMeta = { add?: { id: string; anchor: ImageAnchor }; remove?: string };

// Maps like the selection does, so an untouched cursor still matches.
const mapRange = ({ from, to }: DocRange, mapping: Mappable): DocRange => ({ from: mapping.map(from, 1), to: mapping.map(to, 1) });

const imageAnchorsKey = new PluginKey<Map<string, ImageAnchor>>('imageUploadAnchors');
const imageAnchorsPlugin = new Plugin({
  key: imageAnchorsKey,
  state: {
    init: () => new Map<string, ImageAnchor>(),
    apply(transaction, previous) {
      const meta = transaction.getMeta(imageAnchorsKey) as ImageAnchorMeta | undefined;
      if (!meta && !transaction.docChanged) return previous;
      const anchors = new Map<string, ImageAnchor>();
      for (const [id, { at, cursor }] of previous) {
        anchors.set(id, { at: mapRange(at, transaction.mapping), cursor: mapRange(cursor, transaction.mapping) });
      }
      if (meta?.remove) anchors.delete(meta.remove);
      if (meta?.add) anchors.set(meta.add.id, meta.add.anchor);
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

/** Whether keyboard focus is in a text field outside the editor, such as the file name or a comment box. */
function typingElsewhere(editor: Editor): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || editor.view.dom.contains(active)) return false;
  return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

function placeImages(editor: Editor, images: JSONContent[], { at, cursor }: ImageAnchor) {
  const { doc, schema, selection } = editor.state;
  // The cursor moves past the images only if it has not been moved since they were added.
  const follow = selection.from === cursor.from && selection.to === cursor.to && !typingElsewhere(editor);
  const $at = doc.resolve(at.from);
  const index = $at.depth > 0 ? $at.index(-1) : 0;
  // Images added on an empty line go above it, so writing can continue below them.
  const onEmptyLine =
    at.from === at.to &&
    $at.depth > 0 &&
    $at.parent.isTextblock &&
    $at.parent.content.size === 0 &&
    $at.node(-1).canReplaceWith(index, index, schema.nodes.image);
  editor.chain().insertContentAt(onEmptyLine ? $at.before() : at, images, { updateSelection: follow }).run();
  if (!follow) return;
  const after = editor.state.selection;
  // Leave a text cursor after the images rather than a selected image that typing would replace.
  if (after instanceof NodeSelection && after.node.type === schema.nodes.image && editor.state.doc.resolve(after.to).nodeAfter?.isTextblock) {
    editor.commands.setTextSelection(after.to + 1);
  }
  editor.view.focus();
}

/** Uploads pasted, dropped or picked images and inserts them in order where they were added, even if the document changes meanwhile. */
export async function insertImages(editor: Editor, files: File[], pos: number | null, onError?: (error: unknown) => void) {
  const id = crypto.randomUUID();
  const { from, to } = editor.state.selection;
  const anchor: ImageAnchor = { at: pos === null ? { from, to } : { from: pos, to: pos }, cursor: { from, to } };
  editor.view.dispatch(editor.state.tr.setMeta(imageAnchorsKey, { add: { id, anchor } }));
  try {
    const uploads = await Promise.allSettled(files.map((file) => api.upload(file)));
    const images: JSONContent[] = [];
    uploads.forEach((upload, index) => {
      if (upload.status === 'rejected') onError?.(upload.reason);
      else images.push({ type: 'image', attrs: { src: upload.value, alt: files[index].name.replace(/\.[^.]+$/, '') } });
    });
    if (!images.length || editor.isDestroyed || !editor.isEditable) return;
    const current = imageAnchorsKey.getState(editor.state)?.get(id);
    if (current) placeImages(editor, images, current);
  } finally {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(imageAnchorsKey, { remove: id }));
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
