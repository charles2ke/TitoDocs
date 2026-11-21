import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CircleCheck, MessageSquareReply, RotateCcw, ThumbsUp, Trash2 } from 'lucide-react';
import * as Y from 'yjs';
import { useUser } from '../auth';
import { Avatar } from '../components/ui';
import { formatDateTime, formatTime } from '../lib/util';
import { useDeleteItem, type ComponentViewProps } from './rows';
import {
  itemId,
  itemsOf,
  newItem,
  peopleIn,
  peopleMapOf,
  personOf,
  textOf,
  togglePerson,
  toPerson,
  useYChanges,
  YTextArea,
  type Item,
  type Person,
} from './yjs';

type Sort = 'top' | 'newest' | 'oldest';

const createdAtOf = (item: Item): number => {
  const value = item.get('createdAt');
  return typeof value === 'number' ? value : 0;
};

const upvotesOf = (item: Item): number => peopleIn(peopleMapOf(item, 'upvotes')).length;

const answersOf = (item: Item): Y.Array<Item> | null => {
  const value = item.get('answers');
  return value instanceof Y.Array ? (value as Y.Array<Item>) : null;
};

const SORTS: Record<Sort, (a: Item, b: Item) => number> = {
  top: (a, b) => upvotesOf(b) - upvotesOf(a) || createdAtOf(a) - createdAtOf(b),
  newest: (a, b) => createdAtOf(b) - createdAtOf(a),
  oldest: (a, b) => createdAtOf(a) - createdAtOf(b),
};

/** Submits on Enter; Shift+Enter adds a line break. */
const submitOnEnter = (submit: () => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  submit();
};

/** Questions that people upvote and answer (like a Loop Q&A). */
export function QnaView({ room, editable, autoFocus, onAutoFocused }: ComponentViewProps) {
  const items = useMemo(() => itemsOf(room.doc), [room]);
  useYChanges(items);
  const me = toPerson(useUser());
  const [sort, setSort] = useState<Sort>('top');
  const [draft, setDraft] = useState('');
  const askRef = useRef<HTMLTextAreaElement>(null);

  const focusAsk = useEffectEvent(() => {
    onAutoFocused();
    askRef.current?.focus();
  });
  useEffect(() => {
    if (autoFocus && editable) focusAsk();
  }, [autoFocus, editable]);

  const ask = (event?: FormEvent) => {
    event?.preventDefault();
    const question = draft.trim();
    if (!question) return;
    const { item } = newItem({
      text: new Y.Text(question),
      author: me,
      createdAt: Date.now(),
      upvotes: new Y.Map<Person>(),
      answers: new Y.Array<Item>(),
      resolved: false,
    });
    items.push([item]);
    setDraft('');
  };

  // Open questions come first.
  const list = items.toArray().sort((a, b) => Number(a.get('resolved') === true) - Number(b.get('resolved') === true) || SORTS[sort](a, b));

  return (
    <div className="loop-qna">
      {editable && (
        <form className="qna-ask" onSubmit={ask}>
          <Avatar user={me} size={28} />
          <textarea
            ref={askRef}
            rows={1}
            className="y-textarea"
            value={draft}
            placeholder="Ask a question"
            aria-label="Ask a question"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={submitOnEnter(ask)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
            Ask
          </button>
        </form>
      )}
      {list.length > 0 && (
        <div className="loop-list-summary">
          <span>
            {list.length} {list.length === 1 ? 'question' : 'questions'}
          </span>
          <label className="qna-sort">
            Sort by
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="top">Most upvoted</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        </div>
      )}
      {list.map((item) => (
        <Question key={itemId(item)} items={items} item={item} editable={editable} me={me} />
      ))}
      {!list.length && <p className="loop-empty">{editable ? 'No questions yet. Ask the first one!' : 'No questions yet.'}</p>}
    </div>
  );
}

interface QuestionProps {
  items: Y.Array<Item>;
  item: Item;
  editable: boolean;
  me: Person;
}

function Question({ items, item, editable, me }: QuestionProps) {
  const deleteItem = useDeleteItem();
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState('');
  const text = textOf(item);
  if (!text) return null;
  const author = personOf(item, 'author');
  const upvotes = peopleMapOf(item, 'upvotes');
  const upvoters = peopleIn(upvotes);
  const upvoted = upvoters.some((person) => person.id === me.id);
  const answers = answersOf(item);
  const resolved = item.get('resolved') === true;
  const mine = author?.id === me.id;

  const reply = (event?: FormEvent) => {
    event?.preventDefault();
    const answer = draft.trim();
    if (!answer || !answers) return;
    answers.push([newItem({ text: new Y.Text(answer), author: me, createdAt: Date.now() }).item]);
    setDraft('');
    setAnswering(false);
  };

  return (
    <article className={`qna-question ${resolved ? 'is-resolved' : ''}`} data-item-id={itemId(item)}>
      <button
        type="button"
        className="qna-upvote"
        aria-pressed={upvoted}
        disabled={!editable || !upvotes}
        aria-label={`${upvoted ? 'Remove upvote' : 'Upvote'} (${upvoters.length})`}
        title={upvoters.length ? upvoters.map((person) => person.name).join(', ') : 'Upvote'}
        onClick={() => upvotes && togglePerson(upvotes, me)}
      >
        <ThumbsUp size={16} />
        <span>{upvoters.length}</span>
      </button>
      <div className="qna-body">
        <Byline author={author} createdAt={createdAtOf(item)}>
          {resolved && (
            <span className="loop-badge loop-badge-success">
              <CircleCheck size={12} /> Answered
            </span>
          )}
        </Byline>
        <YTextArea text={text} className="qna-text" aria-label="Question" readOnly={!editable || !mine} />
        {answers && answers.length > 0 && (
          <ul className="qna-answers" aria-label="Answers">
            {answers.toArray().map((answer) => (
              <Answer key={itemId(answer)} answers={answers} answer={answer} editable={editable} me={me} />
            ))}
          </ul>
        )}
        {editable && answering && (
          <form className="qna-reply" onSubmit={reply}>
            <textarea
              rows={2}
              className="y-textarea"
              value={draft}
              autoFocus
              placeholder="Write an answer"
              aria-label="Answer"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setAnswering(false);
                else submitOnEnter(reply)(event);
              }}
            />
            <div className="qna-reply-actions">
              <button type="button" className="btn btn-sm" onClick={() => setAnswering(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={!draft.trim()}>
                Reply
              </button>
            </div>
          </form>
        )}
        {editable && !answering && (
          <div className="qna-actions">
            <button type="button" className="btn btn-sm" onClick={() => setAnswering(true)}>
              <MessageSquareReply size={14} /> Answer
            </button>
            <button type="button" className="btn btn-sm" onClick={() => item.set('resolved', !resolved)}>
              {resolved ? <RotateCcw size={14} /> : <CircleCheck size={14} />} {resolved ? 'Reopen' : 'Mark as answered'}
            </button>
            {mine && (
              <button type="button" className="btn btn-sm" onClick={() => deleteItem(items, item, 'Question')}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Answer({ answers, answer, editable, me }: { answers: Y.Array<Item>; answer: Item; editable: boolean; me: Person }) {
  const deleteItem = useDeleteItem();
  const text = textOf(answer);
  if (!text) return null;
  const author = personOf(answer, 'author');
  const mine = author?.id === me.id;
  return (
    <li className="qna-answer">
      <Byline author={author} createdAt={createdAtOf(answer)}>
        {editable && mine && (
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Delete answer" title="Delete answer" onClick={() => deleteItem(answers, answer, 'Answer')}>
            <Trash2 size={14} />
          </button>
        )}
      </Byline>
      <YTextArea text={text} className="qna-text" aria-label="Answer" readOnly={!editable || !mine} />
    </li>
  );
}

function Byline({ author, createdAt, children }: { author: Person | null; createdAt: number; children?: ReactNode }) {
  return (
    <div className="qna-byline">
      {author && <Avatar user={author} size={20} />}
      <strong>{author?.name ?? 'Someone'}</strong>
      {createdAt > 0 && (
        <time className="muted" dateTime={new Date(createdAt).toISOString()} title={formatDateTime(createdAt)}>
          {formatTime(createdAt)}
        </time>
      )}
      {children}
    </div>
  );
}
