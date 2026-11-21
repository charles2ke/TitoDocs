import type { ReactNode } from 'react';
import { Code2, FileText, Layers, LayoutGrid, StickyNote } from 'lucide-react';
import type { FileType, PublicUser } from '@shared/types';
import type { AwarenessUser } from '../collab';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="progressbar" aria-label={label} />;
}

export function FullPageSpinner() {
  return (
    <div className="splash">
      <Spinner />
    </div>
  );
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';

export function Avatar({ user, size = 28, title }: { user: Pick<PublicUser, 'color'> & { name: string }; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title ?? user.name}
      style={{ background: user.color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(user.name)}
    </span>
  );
}

export function PresenceStack({ people, max = 4 }: { people: AwarenessUser[]; max?: number }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <div className="presence" aria-label={`${people.length} other ${people.length === 1 ? 'person' : 'people'} here`}>
      {shown.map((person) => (
        <Avatar key={person.id} user={person} size={30} />
      ))}
      {people.length > max && <span className="avatar avatar-more">+{people.length - max}</span>}
    </div>
  );
}

export function FileTypeIcon({ type, icon, size = 18 }: { type: FileType; icon?: string | null; size?: number }) {
  if (icon) {
    return (
      <span className="file-emoji" style={{ fontSize: size }} aria-hidden>
        {icon}
      </span>
    );
  }
  const props = { size, 'aria-hidden': true } as const;
  switch (type) {
    case 'doc':
      return <FileText {...props} className="type-doc" />;
    case 'code':
      return <Code2 {...props} className="type-code" />;
    case 'workspace':
      return <LayoutGrid {...props} className="type-workspace" />;
    case 'page':
      return <StickyNote {...props} className="type-page" />;
    case 'component':
      return <Layers {...props} className="type-component" />;
  }
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="10" y="4" width="44" height="56" rx="6" fill="#1a73e8" />
      <path d="M40 4v12a4 4 0 0 0 4 4h10" fill="#8ab4f8" />
      <rect x="18" y="28" width="28" height="4" rx="2" fill="#fff" />
      <rect x="18" y="36" width="28" height="4" rx="2" fill="#fff" />
      <rect x="18" y="44" width="18" height="4" rx="2" fill="#fff" />
    </svg>
  );
}
