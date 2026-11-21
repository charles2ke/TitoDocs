import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import * as Y from 'yjs';
import { AssigneePicker } from './AssigneePicker';
import { DueDate, ItemMenu, onRowKeyDown, todayIso, type ComponentViewProps } from './rows';
import { itemId, itemsOf, newItem, personOf, stringOf, textOf, useFocusRequest, useYChanges, YTextArea, YTextInput, type Item } from './yjs';

export const STATUSES = [
  { id: 'not-started', label: 'Not started' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
] as const;

type Status = (typeof STATUSES)[number]['id'];

const statusOf = (item: Item): Status => {
  const value = stringOf(item, 'status');
  return STATUSES.some((status) => status.id === value) ? (value as Status) : 'not-started';
};

const createEntry = (text = '') =>
  newItem({ text: new Y.Text(text), status: 'not-started', assignee: null, due: null, notes: new Y.Text(), createdAt: Date.now() });

/** Work items with a status, owner, due date and notes (like a Loop progress tracker). */
export function ProgressView({ room, editable, autoFocus, onAutoFocused }: ComponentViewProps) {
  const items = useMemo(() => itemsOf(room.doc), [room]);
  useYChanges(items);
  const container = useRef<HTMLDivElement>(null);
  const focus = useFocusRequest(container);
  const list = items.toArray();
  const counts = STATUSES.map((status) => ({ ...status, count: list.filter((item) => statusOf(item) === status.id).length }));

  const add = () => {
    const created = createEntry();
    items.push([created.item]);
    focus(created.id, 'text', 'start');
  };

  const focusFirst = useEffectEvent(() => {
    onAutoFocused();
    if (items.length) focus(itemId(items.get(0)));
    else add();
  });
  useEffect(() => {
    if (autoFocus && editable) focusFirst();
  }, [autoFocus, editable]);

  return (
    <div className="loop-list loop-progress" ref={container}>
      {list.length > 0 && (
        <div className="loop-list-summary">
          <span className="status-bar" role="img" aria-label={counts.map((status) => `${status.count} ${status.label.toLowerCase()}`).join(', ')}>
            {counts.map((status) => (status.count ? <span key={status.id} className={`status-${status.id}`} style={{ flexGrow: status.count }} /> : null))}
          </span>
          <span className="status-legend">
            {counts
              .filter((status) => status.count)
              .map((status) => (
                <span key={status.id}>
                  <i className={`status-dot status-${status.id}`} /> {status.count} {status.label.toLowerCase()}
                </span>
              ))}
          </span>
        </div>
      )}
      {list.length > 0 && (
        <div className="loop-row progress-row progress-head" aria-hidden>
          <span>Item</span>
          <span>Status</span>
          <span>Assigned to</span>
          <span>Due date</span>
        </div>
      )}
      {list.map((item) => (
        <ProgressRow key={itemId(item)} items={items} item={item} editable={editable} focus={focus} />
      ))}
      {!list.length && !editable && <p className="loop-empty">Nothing is being tracked yet.</p>}
      {editable && (
        <button type="button" className="loop-add" onClick={add}>
          <Plus size={16} /> Add an item
        </button>
      )}
    </div>
  );
}

interface ProgressRowProps {
  items: Y.Array<Item>;
  item: Item;
  editable: boolean;
  focus: (id: string, field?: string, caret?: 'start' | 'end') => void;
}

function ProgressRow({ items, item, editable, focus }: ProgressRowProps) {
  const text = textOf(item);
  const notes = textOf(item, 'notes');
  // Viewers only see notes once there are some, so follow their text.
  useYChanges(editable ? null : notes, true);
  if (!text) return null;
  const status = statusOf(item);
  const due = stringOf(item, 'due');
  return (
    <div className={`loop-row progress-row ${status === 'done' ? 'is-done' : ''}`} data-item-id={itemId(item)}>
      <span className="progress-name">
        <YTextInput
          text={text}
          data-field="text"
          className="loop-row-text"
          placeholder={editable ? 'Item name' : ''}
          aria-label="Item"
          readOnly={!editable}
          onKeyDown={(event) => editable && onRowKeyDown(event, { items, item, text, focus, create: createEntry })}
        />
        {notes && (editable || notes.length > 0) && (
          <YTextArea text={notes} data-field="notes" className="loop-row-notes" placeholder="Add notes" aria-label="Notes" readOnly={!editable} />
        )}
      </span>
      <select
        className={`status-select status-${status}`}
        value={status}
        disabled={!editable}
        aria-label="Status"
        onChange={(event) => item.set('status', event.target.value)}
      >
        {STATUSES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="progress-cell">
        <AssigneePicker value={personOf(item, 'assignee')} editable={editable} onChange={(person) => item.set('assignee', person)} />
      </span>
      <span className="progress-cell">
        <DueDate value={due} editable={editable} overdue={status !== 'done' && !!due && due < todayIso()} onChange={(value) => item.set('due', value)} />
      </span>
      <span className="loop-row-end">{editable && <ItemMenu items={items} item={item} noun="Item" />}</span>
    </div>
  );
}
