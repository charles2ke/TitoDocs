import { useState } from 'react';
import { shortcut } from '../lib/util';
import { Dialog } from './Dialog';

export interface ShortcutGroup {
  title: string;
  /** Labels with keys written for `shortcut()` (like `Mod-Shift-z`), or a single character typed as is. */
  items: [label: string, keys: string][];
}

/** A searchable list of keyboard shortcuts. */
export function ShortcutsDialog({ groups, onClose }: { groups: readonly ShortcutGroup[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} wide>
      <input
        className="shortcuts-search"
        type="search"
        placeholder="Search keyboard shortcuts"
        aria-label="Search keyboard shortcuts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <div className="shortcuts-grid">
        {groups.map((group) => {
          const items = group.items.filter(([label]) => label.toLowerCase().includes(needle));
          if (!items.length) return null;
          return (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <table className="shortcuts-table">
                <tbody>
                  {items.map(([label, keys]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>
                        <kbd className="kbd">{keys.length === 1 ? keys : shortcut(keys)}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
