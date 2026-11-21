import type { KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Ellipsis, Trash2 } from 'lucide-react';
import type * as Y from 'yjs';
import type { Room } from '../collab';
import { Dropdown, separator } from '../components/Menu';
import { useToast } from '../components/Toast';
import { moveItem, type Item } from './yjs';

/** What every component body receives. */
export interface ComponentViewProps {
  room: Room;
  editable: boolean;
  /** The component was just inserted: put the cursor in it once it is ready. */
  autoFocus: boolean;
  onAutoFocused: () => void;
  /** Shown in a card on a page, or on its own (`/c/:id`). */
  variant: 'card' | 'page';
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Today as `YYYY-MM-DD` in the local time zone (the format of date inputs). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const formatDue = (value: string): string =>
  new Date(`${value}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: value.slice(0, 4) === todayIso().slice(0, 4) ? undefined : 'numeric' });

interface DueDateProps {
  value: string | null;
  editable: boolean;
  overdue: boolean;
  onChange: (value: string | null) => void;
}

export function DueDate({ value, editable, overdue, onChange }: DueDateProps) {
  const className = `loop-date ${overdue ? 'is-overdue' : ''} ${value ? '' : 'is-empty'}`;
  if (!editable) {
    return value ? (
      <span className={className} title={overdue ? 'Overdue' : 'Due date'}>
        {formatDue(value)}
      </span>
    ) : null;
  }
  return (
    <input
      type="date"
      className={className}
      value={value ?? ''}
      aria-label="Due date"
      title={overdue ? 'Overdue' : 'Due date'}
      onChange={(event) => onChange(event.target.value || null)}
    />
  );
}

/** Deletes an item, offering to put it back from a toast. */
export function useDeleteItem() {
  const toast = useToast();
  return (items: Y.Array<Item>, item: Item, noun: string) => {
    const index = items.toArray().indexOf(item);
    if (index < 0) return;
    const copy = item.clone();
    items.delete(index, 1);
    toast.show(`${noun} deleted`, {
      action: { label: 'Undo', onClick: () => items.insert(Math.min(index, items.length), [copy]) },
    });
  };
}

/** Move and delete actions for a row. */
export function ItemMenu({ items, item, noun }: { items: Y.Array<Item>; item: Item; noun: string }) {
  const deleteItem = useDeleteItem();
  return (
    <Dropdown
      align="end"
      className="loop-row-menu"
      label={`${noun} options`}
      trigger={(props) => (
        <button type="button" className="icon-btn icon-btn-sm" aria-label={`${noun} options`} title="More options" {...props}>
          <Ellipsis size={16} />
        </button>
      )}
      items={() => {
        const index = items.toArray().indexOf(item);
        return [
          { label: 'Move up', icon: <ArrowUp size={16} />, disabled: index <= 0, onSelect: () => moveItem(items, index, index - 1) },
          {
            label: 'Move down',
            icon: <ArrowDown size={16} />,
            disabled: index < 0 || index >= items.length - 1,
            onSelect: () => moveItem(items, index, index + 1),
          },
          separator,
          { label: `Delete ${noun.toLowerCase()}`, icon: <Trash2 size={16} />, danger: true, onSelect: () => deleteItem(items, item, noun) },
        ];
      }}
    />
  );
}

interface RowKeyOptions {
  items: Y.Array<Item>;
  item: Item;
  text: Y.Text;
  focus: (id: string, field?: string, caret?: 'start' | 'end') => void;
  /** Creates the row added by Enter, holding the text after the caret. */
  create: (text: string) => { id: string; item: Item };
  /** Backspace in an empty row deletes it. */
  removeWhenEmpty?: boolean;
}

/** Enter adds a row below (splitting the text), Backspace removes an empty row and the arrow keys move between rows. */
export function onRowKeyDown(event: KeyboardEvent<HTMLInputElement>, options: RowKeyOptions): void {
  const { items, item, text, focus, create, removeWhenEmpty } = options;
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const input = event.currentTarget;
  const fields = [...(input.closest('.loop-list')?.querySelectorAll<HTMLInputElement>('[data-field="text"]') ?? [])];
  const position = fields.indexOf(input);
  const idOf = (field: HTMLElement | undefined) => field?.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const index = items.toArray().indexOf(item);
    if (index < 0) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const created = create(input.value.slice(end));
    items.doc?.transact(() => {
      if (input.value.length > start) text.delete(start, input.value.length - start);
      items.insert(index + 1, [created.item]);
    });
    focus(created.id, 'text', 'start');
  } else if (event.key === 'Backspace' && removeWhenEmpty && !input.value) {
    event.preventDefault();
    const index = items.toArray().indexOf(item);
    if (index < 0) return;
    const next = idOf(fields[position - 1] ?? fields[position + 1]);
    items.delete(index, 1);
    if (next) focus(next, 'text', 'end');
  } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
    const target = fields[position + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    event.preventDefault();
    const caret = Math.min(input.selectionStart ?? 0, target.value.length);
    target.focus();
    target.setSelectionRange(caret, caret);
  }
}

