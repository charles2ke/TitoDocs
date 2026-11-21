import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useDismiss } from '../lib/util';

export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      onSelect?: () => void;
      disabled?: boolean;
      checked?: boolean;
      danger?: boolean;
      submenu?: MenuEntry[];
      /** Test id for end-to-end tests. */
      testId?: string;
      /** Style for the label, e.g. to preview a font. */
      style?: CSSProperties;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'custom'; render: (close: () => void) => ReactNode };

export const separator: MenuEntry = { type: 'separator' };

interface MenuListProps {
  items: MenuEntry[];
  onClose: () => void;
  /** Close only this level (submenus) and return focus to the parent item. */
  onBack?: () => void;
  autoFocus?: boolean;
  className?: string;
  label?: string;
  /** Opens beside the parent item; fixed positioning keeps the parent menu's scrolling from clipping it. */
  submenu?: boolean;
}

export function MenuList({ items, onClose, onBack, autoFocus = true, className = '', label, submenu = false }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [position, setPosition] = useState<CSSProperties>();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!submenu) {
      const overflow = rect.right - (window.innerWidth - 8);
      if (overflow > 0) setPosition({ marginLeft: -Math.min(overflow, rect.left - 8) });
      return;
    }
    const item = element.parentElement!.getBoundingClientRect();
    let left = item.right - 4;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, item.left - rect.width + 4);
    const top = Math.max(8, Math.min(item.top - 7, window.innerHeight - 8 - rect.height));
    setPosition({ left, top });
  }, [submenu]);

  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [autoFocus]);

  const focusables = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const elements = focusables();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      elements[(index + step + elements.length) % elements.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      elements[event.key === 'Home' ? 0 : elements.length - 1]?.focus();
    } else if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      (onBack ?? onClose)();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`menu ${submenu ? 'submenu' : ''} ${className}`}
      style={position}
      onKeyDown={onKeyDown}
      // A fixed submenu would drift away from its item, so close it instead.
      onScroll={(event) => event.target === event.currentTarget && setOpenSub(null)}
      tabIndex={-1}
    >
      {items.map((entry, index) => {
        if (entry.type === 'separator') return <div key={index} className="menu-separator" role="separator" />;
        if (entry.type === 'label') {
          return (
            <div key={index} className="menu-label">
              {entry.label}
            </div>
          );
        }
        if (entry.type === 'custom') return <div key={index}>{entry.render(onClose)}</div>;
        const hasSub = !!entry.submenu?.length;
        const select = () => {
          if (entry.disabled) return;
          if (hasSub) {
            setOpenSub(index);
            return;
          }
          onClose();
          entry.onSelect?.();
        };
        return (
          <div
            key={index}
            role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? openSub === index : undefined}
            data-testid={entry.testId}
            tabIndex={-1}
            className={`menu-item ${entry.danger ? 'menu-item-danger' : ''} ${openSub === index ? 'menu-item-open' : ''}`}
            onClick={select}
            onPointerEnter={(event) => {
              if (hasSub && !entry.disabled) setOpenSub(index);
              else setOpenSub(null);
              (event.currentTarget as HTMLElement).focus({ preventScroll: true });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || (event.key === 'ArrowRight' && hasSub)) {
                event.preventDefault();
                event.stopPropagation();
                select();
              }
            }}
          >
            <span className="menu-check">{entry.checked && <Check size={14} />}</span>
            {entry.icon && <span className="menu-icon">{entry.icon}</span>}
            <span className="menu-text" style={entry.style}>
              {entry.label}
            </span>
            {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
            {hasSub && <ChevronRight size={14} className="menu-chevron" />}
            {hasSub && openSub === index && (
              <MenuList
                items={entry.submenu!}
                onClose={onClose}
                onBack={() => {
                  setOpenSub(null);
                  (ref.current?.children[index] as HTMLElement | undefined)?.focus();
                }}
                submenu
                autoFocus
                label={entry.label}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface DropdownProps {
  items: MenuEntry[] | (() => MenuEntry[]);
  /** Renders the trigger button; spread `props` onto it. */
  trigger: (props: {
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
  }) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
  label?: string;
}

export function Dropdown({ items, trigger, align = 'start', className = '', label }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const close = () => {
    setOpen(false);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  };
  return (
    <div ref={ref} className={`dropdown ${className}`}>
      {trigger({ onClick: () => setOpen((value) => !value), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <div className={`dropdown-panel dropdown-${align}`}>
          <MenuList items={typeof items === 'function' ? items() : items} onClose={close} label={label} />
        </div>
      )}
    </div>
  );
}

export interface MenuBarMenu {
  label: string;
  items: MenuEntry[] | (() => MenuEntry[]);
}

/** A desktop-style menu bar (File, Edit, View, ...). */
export function MenuBar({ menus, label = 'Menu bar' }: { menus: MenuBarMenu[]; label?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useDismiss<HTMLDivElement>(open !== null, () => setOpen(null));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (step: number) => {
    setOpen((current) => {
      const next = ((current ?? 0) + step + menus.length) % menus.length;
      buttons.current[next]?.focus();
      return next;
    });
  };

  return (
    <div
      ref={ref}
      className="menubar"
      role="menubar"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          if (event.defaultPrevented) return;
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      {menus.map((menu, index) => (
        <div key={menu.label} className="menubar-entry">
          <button
            ref={(element) => {
              buttons.current[index] = element;
            }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === index}
            className={`menubar-button ${open === index ? 'active' : ''}`}
            onClick={() => setOpen(open === index ? null : index)}
            onPointerEnter={() => open !== null && open !== index && setOpen(index)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setOpen(index);
              }
            }}
          >
            {menu.label}
          </button>
          {open === index && (
            <div className="dropdown-panel dropdown-start">
              <MenuList
                items={typeof menu.items === 'function' ? menu.items() : menu.items}
                onClose={() => {
                  setOpen(null);
                  buttons.current[index]?.focus();
                }}
                label={menu.label}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
