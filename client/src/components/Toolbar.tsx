// Controls shared by the editors' toolbars (styled by `.app-toolbar` in app.css).
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { shortcut } from '../lib/util';
import { Dropdown, type MenuEntry } from './Menu';

interface ToolButtonProps {
  label: string;
  /** The key binding, in the notation of `shortcut()`. */
  keys?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}

/** A toolbar button that keeps the focus (and selection) in the editor. */
export function ToolButton({ label, keys, icon, active, disabled, onClick, testId }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-btn ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={keys ? `${label} (${shortcut(keys)})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}

export const ToolDivider = () => <span className="tool-divider" aria-hidden="true" />;

interface ToolDropdownProps {
  label: string;
  items: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
  className?: string;
  testId?: string;
  align?: 'start' | 'end';
}

export function ToolDropdown({ label, items, children, className = '', testId, align }: ToolDropdownProps) {
  return (
    <Dropdown
      label={label}
      items={items}
      align={align}
      trigger={(props) => (
        <button type="button" className={`tool-btn tool-dropdown ${className}`} aria-label={label} title={label} data-testid={testId} {...props}>
          {children}
          <ChevronDown size={14} className="tool-chevron" />
        </button>
      )}
    />
  );
}
