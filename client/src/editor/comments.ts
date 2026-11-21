import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { randomId } from '../lib/util';

export interface CommentAuthor {
  id: string;
  name: string;
  color: string;
}

export interface CommentReply {
  id: string;
  author: CommentAuthor;
  text: string;
  createdAt: number;
}

export interface CommentThread extends CommentReply {
  quote: string;
  resolved: boolean;
  replies: CommentReply[];
  /** Current position of the commented text, or null if it was deleted. */
  from: number | null;
  to: number | null;
}

/** threads: Y.Map<threadId, Y.Map<field, value>>; replies are a Y.Array of plain objects. */
export type ThreadsMap = Y.Map<Y.Map<unknown>>;

const newId = randomId;

/** A range tied to the shared document, so it follows the text through everyone's edits. */
export interface AnchoredRange {
  anchor: Uint8Array;
  head: Uint8Array;
  quote: string;
}

function resolveAnchors(state: EditorState, anchor: unknown, head: unknown): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(state);
  if (!sync?.binding || !(anchor instanceof Uint8Array) || !(head instanceof Uint8Array)) return null;
  try {
    const from = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.decodeRelativePosition(anchor), sync.binding.mapping);
    const to = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.decodeRelativePosition(head), sync.binding.mapping);
    if (from === null || to === null || from >= to || to > state.doc.content.size) return null;
    return { from, to };
  } catch {
    return null;
  }
}

const resolveRange = (state: EditorState, thread: Y.Map<unknown>) => resolveAnchors(state, thread.get('anchor'), thread.get('head'));

/** Anchors the range `from`–`to` to the shared document (null when it is empty or the editor is not synced). */
export function anchorRange(state: EditorState, range: { from: number; to: number }): AnchoredRange | null {
  const sync = ySyncPluginKey.getState(state);
  if (!sync?.binding || range.from >= range.to) return null;
  return {
    anchor: Y.encodeRelativePosition(absolutePositionToRelativePosition(range.from, sync.type, sync.binding.mapping)),
    head: Y.encodeRelativePosition(absolutePositionToRelativePosition(range.to, sync.type, sync.binding.mapping)),
    quote: state.doc.textBetween(range.from, range.to, ' ', ' ').slice(0, 300),
  };
}

/** Where an anchored range is now, or null if its text was deleted. */
export const resolveAnchoredRange = (state: EditorState, range: AnchoredRange) => resolveAnchors(state, range.anchor, range.head);

/** Starts a comment thread on an anchored range. */
export function createThread(threads: ThreadsMap, range: AnchoredRange, author: CommentAuthor, text: string): string {
  const id = newId();
  const thread = new Y.Map<unknown>();
  threads.doc!.transact(() => {
    thread.set('id', id);
    thread.set('anchor', range.anchor);
    thread.set('head', range.head);
    thread.set('quote', range.quote);
    thread.set('author', author);
    thread.set('text', text);
    thread.set('createdAt', Date.now());
    thread.set('resolved', false);
    thread.set('replies', new Y.Array<CommentReply>());
    threads.set(id, thread);
  });
  return id;
}

export function addReply(threads: ThreadsMap, threadId: string, author: CommentAuthor, text: string): void {
  const replies = threads.get(threadId)?.get('replies');
  if (replies instanceof Y.Array) replies.push([{ id: newId(), author, text, createdAt: Date.now() } satisfies CommentReply]);
}

export function setResolved(threads: ThreadsMap, threadId: string, resolved: boolean): void {
  threads.get(threadId)?.set('resolved', resolved);
}

export function editComment(threads: ThreadsMap, threadId: string, replyId: string | null, text: string): void {
  const thread = threads.get(threadId);
  if (!thread) return;
  if (!replyId) {
    thread.set('text', text);
    return;
  }
  const replies = thread.get('replies');
  if (!(replies instanceof Y.Array)) return;
  const index = (replies.toArray() as CommentReply[]).findIndex((reply) => reply.id === replyId);
  if (index === -1) return;
  const reply = replies.get(index) as CommentReply;
  threads.doc!.transact(() => {
    replies.delete(index);
    replies.insert(index, [{ ...reply, text }]);
  });
}

export function deleteComment(threads: ThreadsMap, threadId: string, replyId: string | null): void {
  if (!replyId) {
    threads.delete(threadId);
    return;
  }
  const replies = threads.get(threadId)?.get('replies');
  if (!(replies instanceof Y.Array)) return;
  const index = (replies.toArray() as CommentReply[]).findIndex((reply) => reply.id === replyId);
  if (index !== -1) replies.delete(index);
}

/** All threads, in document order (threads whose text was deleted come last). */
export function readThreads(threads: ThreadsMap, state: EditorState): CommentThread[] {
  const list: CommentThread[] = [];
  for (const [id, thread] of threads) {
    if (!(thread instanceof Y.Map)) continue;
    const range = resolveRange(state, thread);
    const replies = thread.get('replies');
    list.push({
      id,
      author: (thread.get('author') as CommentAuthor | undefined) ?? { id: '', name: 'Unknown', color: '#888888' },
      text: String(thread.get('text') ?? ''),
      createdAt: Number(thread.get('createdAt') ?? 0),
      quote: String(thread.get('quote') ?? ''),
      resolved: !!thread.get('resolved'),
      replies: replies instanceof Y.Array ? (replies.toArray() as CommentReply[]) : [],
      from: range?.from ?? null,
      to: range?.to ?? null,
    });
  }
  return list.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity) || a.createdAt - b.createdAt);
}

// ------------------------------------------------------------------ highlighting plugin

interface CommentsPluginState {
  decorations: DecorationSet;
  active: string | null;
  /** The range of a comment being written (highlighted until it is posted or cancelled). */
  pending: AnchoredRange | null;
}

type CommentsMeta = { decorations: DecorationSet } | { active?: string | null; pending?: AnchoredRange | null };

export const commentsPluginKey = new PluginKey<CommentsPluginState>('comments');

/** Adds a selection change to the transaction, keeping one made earlier in the same command chain. */
function setSelectionMeta(tr: Transaction, change: { active?: string | null; pending?: AnchoredRange | null }): void {
  const earlier = tr.getMeta(commentsPluginKey) as CommentsMeta | undefined;
  const merged = earlier && !('decorations' in earlier) ? { ...earlier, ...change } : change;
  tr.setMeta(commentsPluginKey, merged satisfies CommentsMeta).setMeta('addToHistory', false);
}

function buildDecorations(state: EditorState, threads: ThreadsMap, active: string | null, pending: AnchoredRange | null): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [id, thread] of threads) {
    if (!(thread instanceof Y.Map) || thread.get('resolved')) continue;
    const range = resolveRange(state, thread);
    if (!range) continue;
    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        { class: id === active ? 'comment-mark comment-mark-active' : 'comment-mark', 'data-thread-id': id },
        { threadId: id },
      ),
    );
  }
  const draft = pending && resolveAnchoredRange(state, pending);
  if (draft) decorations.push(Decoration.inline(draft.from, draft.to, { class: 'comment-mark comment-mark-active comment-mark-pending' }));
  return DecorationSet.create(state.doc as PMNode, decorations);
}

export interface CommentsOptions {
  threads: ThreadsMap | null;
  /** Called when the user clicks commented text. */
  onActivate: (threadId: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comments: {
      setActiveComment: (threadId: string | null) => ReturnType;
      setPendingComment: (range: AnchoredRange | null) => ReturnType;
    };
  }
}

export const getActiveComment = (state: EditorState): string | null => commentsPluginKey.getState(state)?.active ?? null;
export const getPendingComment = (state: EditorState): AnchoredRange | null => commentsPluginKey.getState(state)?.pending ?? null;

export const Comments = Extension.create<CommentsOptions>({
  name: 'comments',

  addOptions() {
    return { threads: null, onActivate: () => {} };
  },

  addCommands() {
    return {
      setActiveComment:
        (threadId) =>
        ({ tr, dispatch }) => {
          if (dispatch) setSelectionMeta(tr, { active: threadId });
          return true;
        },
      setPendingComment:
        (range) =>
        ({ tr, dispatch }) => {
          if (dispatch) setSelectionMeta(tr, { pending: range });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { threads, onActivate } = this.options;
    if (!threads) return [];
    return [
      new Plugin<CommentsPluginState>({
        key: commentsPluginKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, active: null, pending: null }),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(commentsPluginKey) as CommentsMeta | undefined;
            if (meta && 'decorations' in meta) return { ...previous, decorations: meta.decorations };
            if (meta) {
              const active = meta.active === undefined ? previous.active : meta.active;
              const pending = meta.pending === undefined ? previous.pending : meta.pending;
              return { ...previous, active, pending, decorations: buildDecorations(newState, threads, active, pending) };
            }
            // Positions are recomputed from Yjs after every change (see the view below); map them meanwhile.
            return tr.docChanged ? { ...previous, decorations: previous.decorations.map(tr.mapping, tr.doc) } : previous;
          },
        },
        props: {
          decorations: (state) => commentsPluginKey.getState(state)?.decorations,
          handleClick(view, pos) {
            const found = commentsPluginKey
              .getState(view.state)
              ?.decorations.find(pos, pos)
              .sort((a, b) => a.to - a.from - (b.to - b.from));
            const threadId = (found?.[0]?.spec as { threadId?: string } | undefined)?.threadId;
            if (threadId) onActivate(threadId);
            else if (getActiveComment(view.state)) {
              view.dispatch(view.state.tr.setMeta(commentsPluginKey, { active: null } satisfies CommentsMeta).setMeta('addToHistory', false));
            }
            return false;
          },
        },
        view(view) {
          let frame = 0;
          const recompute = () => {
            frame = 0;
            if (view.isDestroyed) return;
            const plugin = commentsPluginKey.getState(view.state);
            const decorations = buildDecorations(view.state, threads, plugin?.active ?? null, plugin?.pending ?? null);
            view.dispatch(view.state.tr.setMeta(commentsPluginKey, { decorations } satisfies CommentsMeta).setMeta('addToHistory', false));
          };
          // Yjs bindings update after ProseMirror transactions, so wait a frame before resolving positions.
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(recompute);
          };
          threads.observeDeep(schedule);
          schedule();
          return {
            update(updated, previousState) {
              if (!updated.state.doc.eq(previousState.doc)) schedule();
            },
            destroy() {
              cancelAnimationFrame(frame);
              threads.unobserveDeep(schedule);
            },
          };
        },
      }),
    ];
  },
});
