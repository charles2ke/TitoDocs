import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';
import * as Y from 'yjs';
import { ITEMS_FIELD, type PublicUser } from '@shared/types';
import { randomId } from '../lib/util';

/** Someone stored inside a component (an assignee, voter or author). */
export interface Person {
  id: string;
  name: string;
  color: string;
}

export const toPerson = (user: PublicUser): Person => ({ id: user.id, name: user.displayName, color: user.color });

/** One row of a list-based component: a task, tracked item, voting option or question. */
export type Item = Y.Map<unknown>;

export const itemsOf = (doc: Y.Doc): Y.Array<Item> => doc.getArray<Item>(ITEMS_FIELD);

export function textOf(item: Item, key = 'text'): Y.Text | null {
  const value = item.get(key);
  return value instanceof Y.Text ? value : null;
}

export function stringOf(item: Item, key: string): string | null {
  const value = item.get(key);
  return typeof value === 'string' ? value : null;
}

export function isPerson(value: unknown): value is Person {
  const person = value as Person | null;
  return !!person && typeof person.id === 'string' && typeof person.name === 'string' && typeof person.color === 'string';
}

export function personOf(item: Item, key: string): Person | null {
  const value = item.get(key);
  return isPerson(value) ? value : null;
}

/** A map of people keyed by user id, such as votes. */
export function peopleMapOf(item: Item, key: string): Y.Map<Person> | null {
  const value = item.get(key);
  return value instanceof Y.Map ? (value as Y.Map<Person>) : null;
}

export const peopleIn = (map: Y.Map<Person> | null): Person[] => (map ? [...map.values()].filter(isPerson) : []);

/** A new item, with its id (the id of an item cannot be read until it has been added to a document). */
export function newItem(fields: Record<string, unknown>): { id: string; item: Item } {
  const id = randomId();
  const item = new Y.Map<unknown>();
  item.set('id', id);
  for (const [key, value] of Object.entries(fields)) item.set(key, value);
  return { id, item };
}

export const itemId = (item: Item): string => stringOf(item, 'id') ?? '';

/** Moves an item by copying it, as Yjs types cannot be moved. Edits made at the same time to the old copy are lost. */
export function moveItem(array: Y.Array<Item>, from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) return;
  array.doc?.transact(() => {
    const copy = array.get(from).clone();
    array.delete(from, 1);
    array.insert(to, [copy]);
  });
}

/** Toggles a person in a map keyed by user id (votes, upvotes). */
export function togglePerson(map: Y.Map<Person>, person: Person): void {
  if (map.has(person.id)) map.delete(person.id);
  else map.set(person.id, person);
}

/**
 * Re-renders whenever something inside `type` changes. Text edits are skipped unless `includeText` is set:
 * text fields update themselves.
 */
export function useYChanges(type: Y.AbstractType<any> | null, includeText = false): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!type) return;
    const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (!includeText && events.every((event) => event.target instanceof Y.Text)) return;
      setVersion((value) => value + 1);
    };
    type.observeDeep(onChange);
    setVersion((value) => value + 1);
    return () => type.unobserveDeep(onChange);
  }, [type, includeText]);
  return version;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Applies an edited value to a Y.Text as a single replacement of the part that changed. */
export function applyTextChange(text: Y.Text, next: string, origin: unknown): void {
  const previous = text.toString();
  if (previous === next || !text.doc) return;
  const max = Math.min(previous.length, next.length);
  let start = 0;
  while (start < max && previous.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Never split a surrogate pair (emoji): half a pair cannot be encoded in an update.
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && previous.charCodeAt(previous.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  if (end > 0 && isLowSurrogate(previous.charCodeAt(previous.length - end))) end--;
  const removed = previous.length - start - end;
  const inserted = next.slice(start, next.length - end);
  text.doc.transact(() => {
    if (removed > 0) text.delete(start, removed);
    if (inserted) text.insert(start, inserted);
  }, origin);
}

type Delta = { insert?: unknown; delete?: number; retain?: number }[];

/** Where a caret ends up after a remote change. Text inserted exactly at the caret goes after it. */
export function transformIndex(index: number, delta: Delta): number {
  let position = 0;
  let shift = 0;
  for (const op of delta) {
    if (position >= index) break;
    if (op.retain) position += op.retain;
    else if (op.delete) {
      shift -= Math.min(op.delete, index - position);
      position += op.delete;
    } else if (op.insert !== undefined) shift += typeof op.insert === 'string' ? op.insert.length : 1;
  }
  return Math.max(0, index + shift);
}

const fieldSizingSupported = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

function autoGrow(element: HTMLInputElement | HTMLTextAreaElement): void {
  if (fieldSizingSupported || !(element instanceof HTMLTextAreaElement)) return;
  element.style.height = 'auto';
  if (element.scrollHeight) element.style.height = `${element.scrollHeight}px`;
}

/**
 * Binds a plain input to a Y.Text. The input stays uncontrolled: local typing is applied as a diff, and remote
 * changes replace the value while keeping the caret in place.
 */
function useYText<T extends HTMLInputElement | HTMLTextAreaElement>(text: Y.Text) {
  const ref = useRef<T>(null);
  const [origin] = useState(() => ({}));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.value = text.toString();
    autoGrow(element);
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === origin) return;
      const focused = element.ownerDocument.activeElement === element;
      const { selectionStart, selectionEnd, selectionDirection } = element;
      element.value = text.toString();
      if (focused && selectionStart !== null && selectionEnd !== null) {
        const delta = event.delta as Delta;
        element.setSelectionRange(transformIndex(selectionStart, delta), transformIndex(selectionEnd, delta), selectionDirection ?? undefined);
      }
      autoGrow(element);
    };
    text.observe(observer);
    return () => text.unobserve(observer);
  }, [text, origin]);

  const onInput = (event: FormEvent<T>) => {
    applyTextChange(text, event.currentTarget.value, origin);
    autoGrow(event.currentTarget);
  };
  return { ref, onInput };
}

type Uncontrolled<T> = Omit<T, 'value' | 'defaultValue' | 'onChange' | 'onInput'> & { text: Y.Text };

export function YTextInput({ text, ...props }: Uncontrolled<InputHTMLAttributes<HTMLInputElement>>) {
  const { ref, onInput } = useYText<HTMLInputElement>(text);
  return <input {...props} ref={ref} onInput={onInput} />;
}

/** A multi-line text field that grows with its content. */
export function YTextArea({ text, className = '', ...props }: Uncontrolled<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const { ref, onInput } = useYText<HTMLTextAreaElement>(text);
  return <textarea rows={1} {...props} className={`y-textarea ${className}`} ref={ref} onInput={onInput} />;
}

/** Focuses an item's field once it has rendered (e.g. a task that was just added). */
export function useFocusRequest(container: RefObject<HTMLElement | null>) {
  const pending = useRef<{ id: string; field: string; caret: 'start' | 'end' } | null>(null);
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    const element = container.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-item-id="${CSS.escape(request.id)}"] [data-field="${CSS.escape(request.field)}"]`,
    );
    if (!element) return;
    pending.current = null;
    element.focus();
    const caret = request.caret === 'end' ? element.value.length : 0;
    element.setSelectionRange?.(caret, caret);
  });
  return (id: string, field = 'text', caret: 'start' | 'end' = 'end') => {
    pending.current = { id, field, caret };
    setTick((tick) => tick + 1);
  };
}
