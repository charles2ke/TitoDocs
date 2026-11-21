import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { Plus, ThumbsUp } from 'lucide-react';
import * as Y from 'yjs';
import { useUser } from '../auth';
import { Avatar } from '../components/ui';
import { ItemMenu, onRowKeyDown, type ComponentViewProps } from './rows';
import {
  itemId,
  itemsOf,
  newItem,
  peopleIn,
  peopleMapOf,
  textOf,
  togglePerson,
  toPerson,
  useFocusRequest,
  useYChanges,
  YTextArea,
  YTextInput,
  type Item,
  type Person,
} from './yjs';

const createOption = (text = '') => newItem({ text: new Y.Text(text), description: new Y.Text(), votes: new Y.Map<Person>(), createdAt: Date.now() });

const MAX_VOTER_AVATARS = 5;

/** Options that people vote on, one vote per person per option (like a Loop voting table). */
export function VotingView({ room, editable, autoFocus, onAutoFocused }: ComponentViewProps) {
  const items = useMemo(() => itemsOf(room.doc), [room]);
  useYChanges(items);
  const container = useRef<HTMLDivElement>(null);
  const focus = useFocusRequest(container);
  const me = toPerson(useUser());

  const list = items.toArray();
  const votesOf = (item: Item) => peopleIn(peopleMapOf(item, 'votes'));
  const counts = list.map((item) => votesOf(item).length);
  const most = Math.max(0, ...counts);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const voters = new Set(list.flatMap((item) => votesOf(item).map((person) => person.id)));

  const add = () => {
    const created = createOption();
    items.push([created.item]);
    focus(created.id, 'text', 'start');
  };

  const focusFirst = useEffectEvent(() => {
    onAutoFocused();
    if (items.length) {
      focus(itemId(items.get(0)));
      return;
    }
    const first = createOption();
    items.push([first.item, createOption().item]);
    focus(first.id, 'text', 'start');
  });
  useEffect(() => {
    if (autoFocus && editable) focusFirst();
  }, [autoFocus, editable]);

  return (
    <div className="loop-list loop-voting" ref={container}>
      {list.length > 0 && (
        <div className="loop-list-summary">
          <span>
            {total} {total === 1 ? 'vote' : 'votes'} from {voters.size} {voters.size === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}
      {list.map((item, index) => {
        const text = textOf(item);
        const description = textOf(item, 'description');
        const votes = peopleMapOf(item, 'votes');
        if (!text) return null;
        const people = votesOf(item);
        const mine = people.some((person) => person.id === me.id);
        const count = counts[index]!;
        return (
          <div key={itemId(item)} className={`loop-row vote-row ${mine ? 'is-voted' : ''}`} data-item-id={itemId(item)}>
            <span className="vote-bar" style={{ width: most ? `${(count / most) * 100}%` : 0 }} aria-hidden />
            <span className="vote-main">
              <YTextInput
                text={text}
                data-field="text"
                className="loop-row-text"
                placeholder={editable ? `Option ${index + 1}` : ''}
                aria-label="Option"
                readOnly={!editable}
                onKeyDown={(event) => editable && onRowKeyDown(event, { items, item, text, focus, create: createOption })}
              />
              {description && <VoteDescription text={description} editable={editable} />}
            </span>
            {count > 0 && count === most && <span className="loop-badge">Leading</span>}
            <span className="vote-voters" title={people.map((person) => person.name).join(', ')}>
              {people.slice(0, MAX_VOTER_AVATARS).map((person) => (
                <Avatar key={person.id} user={person} size={22} />
              ))}
              {people.length > MAX_VOTER_AVATARS && <span className="avatar avatar-more">+{people.length - MAX_VOTER_AVATARS}</span>}
            </span>
            <button
              type="button"
              className="btn btn-sm vote-btn"
              aria-pressed={mine}
              disabled={!editable || !votes}
              aria-label={`${mine ? 'Remove your vote' : 'Vote'} (${count} ${count === 1 ? 'vote' : 'votes'})`}
              title={mine ? 'Remove your vote' : 'Vote for this option'}
              onClick={() => votes && togglePerson(votes, me)}
            >
              <ThumbsUp size={15} /> {count}
            </button>
            {editable && <ItemMenu items={items} item={item} noun="Option" />}
          </div>
        );
      })}
      {!list.length && !editable && <p className="loop-empty">No options yet.</p>}
      {editable && (
        <button type="button" className="loop-add" onClick={add}>
          <Plus size={16} /> Add an option
        </button>
      )}
    </div>
  );
}

function VoteDescription({ text, editable }: { text: Y.Text; editable: boolean }) {
  useYChanges(editable ? null : text, true);
  if (!editable && !text.length) return null;
  return <YTextArea text={text} data-field="description" className="loop-row-notes" placeholder="Add a description" aria-label="Description" readOnly={!editable} />;
}
