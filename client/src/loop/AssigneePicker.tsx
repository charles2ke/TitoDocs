import { useEffect, useState, type KeyboardEvent } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { api } from '../api';
import { useUser } from '../auth';
import { Avatar } from '../components/ui';
import { useDebounced, useDismiss } from '../lib/util';
import { toPerson, type Person } from './yjs';

interface AssigneePickerProps {
  value: Person | null;
  editable: boolean;
  onChange: (person: Person | null) => void;
}

/** Shows who a task is assigned to, and lets editors pick someone (any TitoDocs user). */
export function AssigneePicker({ value, editable, onChange }: AssigneePickerProps) {
  const me = useUser();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const search = useDebounced(query.trim(), 200);
  const ref = useDismiss<HTMLDivElement>(open, () => close(false));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.searchUsers(search).then(
      (result) => !cancelled && setUsers(result.users),
      () => !cancelled && setUsers([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, search]);

  function close(refocus: boolean) {
    setOpen(false);
    setQuery('');
    if (refocus) ref.current?.querySelector<HTMLElement>('.assignee-btn')?.focus();
  }

  const choose = (person: Person | null) => {
    close(true);
    if (person?.id !== value?.id) onChange(person);
  };

  const chip = value ? (
    <>
      <Avatar user={value} size={22} />
      <span className="assignee-name">{value.name}</span>
    </>
  ) : (
    <>
      <UserPlus size={16} aria-hidden />
      <span className="assignee-name">Assign</span>
    </>
  );

  if (!editable) {
    return value ? (
      <span className="assignee" title={`Assigned to ${value.name}`}>
        {chip}
      </span>
    ) : null;
  }

  // Up and down arrows move between the search box and the people.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const targets = [...(ref.current?.querySelectorAll<HTMLElement>('.assignee-panel input, .assignee-option') ?? [])];
    const index = targets.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      targets[Math.max(0, Math.min(targets.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      ref.current?.querySelector<HTMLElement>('.assignee-option[data-match]')?.click();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
    }
  };

  // Without a search, the current user is offered separately as "Assign to me".
  const people = (users ?? []).filter((user) => search || user.id !== me.id);
  return (
    <div className="assignee-picker" ref={ref}>
      <button
        type="button"
        className={`assignee assignee-btn ${value ? '' : 'is-empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={value ? `Assigned to ${value.name}. Change assignee` : 'Assign'}
        title={value ? `Assigned to ${value.name}` : 'Assign'}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {chip}
      </button>
      {open && (
        <div className="dropdown-panel dropdown-start assignee-panel" role="dialog" aria-label="Assign to" onKeyDown={onKeyDown}>
          <input
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="assignee-options">
            {!search && (
              <button type="button" className="assignee-option" onClick={() => choose(toPerson(me))}>
                <Avatar user={toPerson(me)} size={22} /> Assign to me
              </button>
            )}
            {people.map((user, index) => (
              <button
                key={user.id}
                type="button"
                className="assignee-option"
                data-match={index === 0 ? '' : undefined}
                onClick={() => choose(toPerson(user))}
              >
                <Avatar user={toPerson(user)} size={22} />
                <span>{user.displayName}</span>
                <span className="muted">@{user.username}</span>
              </button>
            ))}
            {users && !people.length && search && <p className="assignee-empty muted">No one found</p>}
            {value && (
              <button type="button" className="assignee-option" onClick={() => choose(null)}>
                <UserMinus size={16} aria-hidden /> Unassign
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
