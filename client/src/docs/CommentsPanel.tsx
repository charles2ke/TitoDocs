import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Check, EllipsisVertical, MessageSquare, RotateCcw, X } from 'lucide-react';
import { ConfirmDialog } from '../components/Dialog';
import { Dropdown } from '../components/Menu';
import { useToast } from '../components/Toast';
import { Avatar } from '../components/ui';
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  getActiveComment,
  getPendingComment,
  readThreads,
  setResolved,
  type CommentAuthor,
  type CommentReply,
  type CommentThread,
  type ThreadsMap,
} from '../editor/comments';
import { formatDateTime, formatTime, shortcut } from '../lib/util';

/** Comment threads in document order, kept up to date as people comment and edit. */
function useThreads(editor: Editor, threads: ThreadsMap): CommentThread[] {
  const [list, setList] = useState<CommentThread[]>(() => readThreads(threads, editor.state));
  useEffect(() => {
    let frame = 0;
    // Positions come from Yjs, which updates after ProseMirror transactions: read them a frame later.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!editor.isDestroyed) setList(readThreads(threads, editor.state));
      });
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) schedule();
    };
    threads.observeDeep(schedule);
    editor.on('transaction', onTransaction);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      threads.unobserveDeep(schedule);
      editor.off('transaction', onTransaction);
    };
  }, [editor, threads]);
  return list;
}

/** Number of unresolved comment threads (for the comments button). */
export function useOpenCommentCount(threads: ThreadsMap | null): number {
  const count = () => (threads ? [...threads.values()].filter((thread) => !thread.get('resolved')).length : 0);
  const [value, setValue] = useState(count);
  useEffect(() => {
    if (!threads) return;
    const update = () => setValue([...threads.values()].filter((thread) => !thread.get('resolved')).length);
    update();
    threads.observeDeep(update);
    return () => threads.unobserveDeep(update);
  }, [threads]);
  return value;
}

/** Scrolls the document to a comment's highlighted text. */
export function revealComment(editor: Editor, threadId: string): void {
  const element = editor.view.dom.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  /** Keep the buttons visible even when the box is empty and unfocused. */
  expanded?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  testId?: string;
}

/** A comment text box: Ctrl+Enter posts, Escape cancels. */
function Composer({ placeholder, submitLabel, initial = '', autoFocus, expanded, onSubmit, onCancel, testId }: ComposerProps) {
  const [text, setText] = useState(initial);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.setSelectionRange(initial.length, initial.length);
  }, [autoFocus, initial.length]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSubmit(value);
    setText('');
  };
  const cancel = () => {
    setText('');
    ref.current?.blur();
    onCancel?.();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const showButtons = expanded || focused || !!text;
  return (
    <form className="comment-composer" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        rows={showButtons ? 3 : 1}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        data-testid={testId}
      />
      {showButtons && (
        <div className="comment-composer-actions">
          <button type="button" className="btn btn-sm" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()} title={`${submitLabel} (${shortcut('Mod-Enter')})`}>
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

interface EntryProps {
  entry: CommentReply;
  canEditOwn: boolean;
  canDelete: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
  extraActions?: ReactNode;
}

function CommentEntry({ entry, canEditOwn, canDelete, onEdit, onDelete, extraActions }: EntryProps) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="comment-entry">
      <div className="comment-entry-header">
        <Avatar user={{ name: entry.author.name, color: entry.author.color }} size={28} />
        <div className="comment-entry-meta">
          <strong>{entry.author.name}</strong>
          <time dateTime={new Date(entry.createdAt).toISOString()} title={formatDateTime(entry.createdAt)}>
            {formatTime(entry.createdAt)}
          </time>
        </div>
        {extraActions}
        {(canEditOwn || canDelete) && (
          <Dropdown
            align="end"
            label="Comment actions"
            items={[
              ...(canEditOwn ? [{ label: 'Edit', onSelect: () => setEditing(true) }] : []),
              ...(canDelete ? [{ label: 'Delete', danger: true, onSelect: onDelete }] : []),
            ]}
            trigger={(props) => (
              <button type="button" className="icon-btn icon-btn-sm" aria-label="More actions" title="More actions" {...props}>
                <EllipsisVertical size={16} />
              </button>
            )}
          />
        )}
      </div>
      {editing ? (
        <Composer
          placeholder="Edit comment"
          submitLabel="Save"
          initial={entry.text}
          autoFocus
          expanded
          onSubmit={(text) => {
            onEdit(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="comment-text">{entry.text}</p>
      )}
    </div>
  );
}

export interface CommentsPanelProps {
  editor: Editor;
  threads: ThreadsMap;
  user: CommentAuthor;
  canComment: boolean;
  /** Editors may delete anyone's comments; everyone else only their own. */
  canModerate: boolean;
  onClose: () => void;
}

type Filter = 'open' | 'resolved' | 'all';

/** The comments sidebar: new comments, replies, resolving and editing. */
export function CommentsPanel({ editor, threads, user, canComment, canModerate, onClose }: CommentsPanelProps) {
  const toast = useToast();
  const list = useThreads(editor, threads);
  const { active, pending } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({ active: getActiveComment(current.state), pending: getPendingComment(current.state) }),
    equalityFn: (a, b) => !!b && a.active === b.active && a.pending === b.pending,
  });
  const [filter, setFilter] = useState<Filter>('open');
  const [confirm, setConfirm] = useState<{ threadId: string; replyId: string | null } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  // Show the active thread, even if it is resolved and hidden by the filter.
  const activeThread = list.find((thread) => thread.id === active);
  useEffect(() => {
    if (activeThread?.resolved && filter === 'open') setFilter('all');
  }, [activeThread, filter]);
  useEffect(() => {
    if (!active) return;
    body.current?.querySelector(`[data-thread="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const visible = list.filter((thread) => filter === 'all' || (filter === 'resolved' ? thread.resolved : !thread.resolved));

  const post = (text: string) => {
    if (!pending) return;
    const id = createThread(threads, pending, user, text);
    editor.chain().setPendingComment(null).setActiveComment(id).run();
  };

  const activate = (thread: CommentThread) => {
    if (thread.id !== active) editor.commands.setActiveComment(thread.id);
    revealComment(editor, thread.id);
  };

  const remove = () => {
    if (!confirm) return;
    deleteComment(threads, confirm.threadId, confirm.replyId);
    if (!confirm.replyId && active === confirm.threadId) editor.commands.setActiveComment(null);
    setConfirm(null);
    toast.show(confirm.replyId ? 'Reply deleted' : 'Comment deleted');
  };

  return (
    <aside className="side-panel comments-panel no-print" aria-label="Comments" data-testid="comments-panel">
      <div className="side-panel-header">
        <h2>Comments</h2>
        <div className="comments-panel-tools">
          <select aria-label="Show comments" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Close comments" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="side-panel-body" ref={body}>
        {pending && canComment && (
          <div className="comment-card comment-card-active comment-card-new" data-testid="new-comment">
            <blockquote className="comment-quote">{pending.quote}</blockquote>
            <Composer
              placeholder="Add a comment"
              submitLabel="Comment"
              autoFocus
              expanded
              onSubmit={post}
              onCancel={() => editor.chain().focus().setPendingComment(null).run()}
              testId="new-comment-input"
            />
          </div>
        )}
        {!visible.length && !pending && (
          <div className="comments-empty">
            <MessageSquare size={32} />
            <p>
              {filter === 'resolved'
                ? 'No resolved comments.'
                : canComment
                  ? `No open comments. Select text and press ${shortcut('Mod-Alt-m')} to add one.`
                  : 'No open comments.'}
            </p>
          </div>
        )}
        {visible.map((thread) => {
          const isActive = thread.id === active;
          const own = thread.author.id === user.id;
          return (
            <article
              key={thread.id}
              data-thread={thread.id}
              className={`comment-card ${isActive ? 'comment-card-active' : ''} ${thread.resolved ? 'comment-card-resolved' : ''}`}
              onClick={() => activate(thread)}
              data-testid="comment-thread"
            >
              {thread.quote && (
                <blockquote className={`comment-quote ${thread.from === null ? 'comment-quote-deleted' : ''}`} title={thread.from === null ? 'The commented text was deleted' : undefined}>
                  {thread.quote}
                </blockquote>
              )}
              <CommentEntry
                entry={thread}
                canEditOwn={own && canComment}
                canDelete={(own || canModerate) && canComment}
                onEdit={(text) => editComment(threads, thread.id, null, text)}
                onDelete={() => setConfirm({ threadId: thread.id, replyId: null })}
                extraActions={
                  canComment &&
                  (thread.resolved ? (
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label="Reopen"
                      title="Reopen"
                      onClick={(event) => {
                        event.stopPropagation();
                        setResolved(threads, thread.id, false);
                      }}
                    >
                      <RotateCcw size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label="Resolve"
                      title="Mark as resolved and hide"
                      onClick={(event) => {
                        event.stopPropagation();
                        setResolved(threads, thread.id, true);
                        if (isActive) editor.commands.setActiveComment(null);
                      }}
                      data-testid="resolve-comment"
                    >
                      <Check size={16} />
                    </button>
                  ))
                }
              />
              {thread.replies.map((reply) => (
                <CommentEntry
                  key={reply.id}
                  entry={reply}
                  canEditOwn={reply.author.id === user.id && canComment}
                  canDelete={(reply.author.id === user.id || canModerate) && canComment}
                  onEdit={(text) => editComment(threads, thread.id, reply.id, text)}
                  onDelete={() => setConfirm({ threadId: thread.id, replyId: reply.id })}
                />
              ))}
              {thread.resolved && <p className="comment-resolved-note">Resolved</p>}
              {canComment && !thread.resolved && (isActive || thread.replies.length > 0) && (
                <Composer placeholder="Reply" submitLabel="Reply" onSubmit={(text) => addReply(threads, thread.id, user, text)} testId="reply-input" />
              )}
            </article>
          );
        })}
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm.replyId ? 'Delete reply?' : 'Delete comment thread?'}
          message={confirm.replyId ? 'This reply will be deleted.' : 'The comment and all of its replies will be deleted.'}
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
    </aside>
  );
}
