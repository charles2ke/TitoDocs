import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import * as Y from 'yjs';
import { AssigneePicker } from './AssigneePicker';
import { DueDate, ItemMenu, onRowKeyDown, todayIso, type ComponentViewProps } from './rows';
import { itemId, itemsOf, newItem, personOf, stringOf, textOf, useFocusRequest, useYChanges, YTextInput, type Item } from './yjs';

const createTask = (text = '') => newItem({ text: new Y.Text(text), done: false, assignee: null, due: null, createdAt: Date.now() });

/** A shared checklist with owners and due dates (like a Loop task list). */
export function TasksView({ room, editable, autoFocus, onAutoFocused }: ComponentViewProps) {
  const items = useMemo(() => itemsOf(room.doc), [room]);
  useYChanges(items);
  const container = useRef<HTMLDivElement>(null);
  const focus = useFocusRequest(container);
  const [hideDone, setHideDone] = useState(false);

  const list = items.toArray();
  const done = list.filter((item) => item.get('done') === true).length;
  const shown = hideDone ? list.filter((item) => item.get('done') !== true) : list;

  const add = () => {
    const created = createTask();
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
    <div className="loop-list loop-tasks" ref={container}>
      {list.length > 0 && (
        <div className="loop-list-summary">
          <span className="loop-progress-label">
            {done} of {list.length} done
          </span>
          <span className="loop-meter" aria-hidden>
            <span style={{ width: `${(done / list.length) * 100}%` }} />
          </span>
          {done > 0 && (
            <button type="button" className="btn btn-sm loop-toggle" aria-pressed={hideDone} onClick={() => setHideDone((value) => !value)}>
              {hideDone ? `Show completed (${done})` : 'Hide completed'}
            </button>
          )}
        </div>
      )}
      {shown.map((item) => (
        <TaskRow key={itemId(item)} items={items} item={item} editable={editable} focus={focus} />
      ))}
      {!list.length && !editable && <p className="loop-empty">No tasks yet.</p>}
      {editable && (
        <button type="button" className="loop-add" onClick={add}>
          <Plus size={16} /> Add a task
        </button>
      )}
    </div>
  );
}

interface TaskRowProps {
  items: Y.Array<Item>;
  item: Item;
  editable: boolean;
  focus: (id: string, field?: string, caret?: 'start' | 'end') => void;
}

function TaskRow({ items, item, editable, focus }: TaskRowProps) {
  const text = textOf(item);
  if (!text) return null;
  const done = item.get('done') === true;
  const due = stringOf(item, 'due');
  return (
    <div className={`loop-row task-row ${done ? 'is-done' : ''}`} data-item-id={itemId(item)}>
      <input
        type="checkbox"
        className="task-check"
        checked={done}
        disabled={!editable}
        aria-label="Done"
        onChange={(event) => item.set('done', event.target.checked)}
      />
      <YTextInput
        text={text}
        data-field="text"
        className="loop-row-text"
        placeholder={editable ? 'Task name' : ''}
        aria-label="Task"
        readOnly={!editable}
        onKeyDown={(event) => editable && onRowKeyDown(event, { items, item, text, focus, create: createTask, removeWhenEmpty: true })}
      />
      <span className="loop-row-meta">
        <AssigneePicker value={personOf(item, 'assignee')} editable={editable} onChange={(person) => item.set('assignee', person)} />
        <DueDate value={due} editable={editable} overdue={!done && !!due && due < todayIso()} onChange={(value) => item.set('due', value)} />
        {editable && <ItemMenu items={items} item={item} noun="Task" />}
      </span>
    </div>
  );
}
