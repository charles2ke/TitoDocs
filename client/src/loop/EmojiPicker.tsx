import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDismiss } from '../lib/util';

const EMOJI_GROUPS: [name: string, emojis: string][] = [
  ['Smileys', '😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😇 🥰 😍 🤩 😎 🤓 🧐 🤔 🤗 🙃 😴 🤯 🥳 😤'],
  ['People', '👋 👍 👎 👏 🙌 🙏 💪 ✌️ 🤝 👀 🧠 👤 👥 🧑‍💻 🎓 💼'],
  ['Nature', '🌱 🌿 🍀 🌵 🌳 🌲 🌸 🌻 🌈 ☀️ 🌙 ⭐ 🔥 💧 ⚡ ❄️ 🌊 🌍 🐶 🐱 🦊 🐼 🦄 🐝'],
  ['Food', '🍎 🍋 🍓 🍉 🍕 🍔 🌮 🍣 🍩 🍪 🎂 ☕ 🍵 🥗'],
  ['Activities', '⚽ 🏀 🎾 🏆 🎯 🎮 🎲 🧩 🎨 🎬 🎤 🎧 🎵 🎉 🎁 🚀 ✈️ 🚗 🏠 🏢 🏝️ 🗺️'],
  ['Objects', '📄 📝 📌 📎 📁 📂 📅 📆 📊 📈 📉 📋 📚 📖 🔖 💡 🔍 🔑 🔒 🔔 📣 💬 💭 ✉️ 📦 🛠️ ⚙️ 🧪 💻 📱 🖥️ ⏰ ⏳ 💰 💳'],
  ['Symbols', '✅ ☑️ ❌ ⚠️ ❗ ❓ 💯 ❤️ 🧡 💛 💚 💙 💜 🖤 ✨ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🏁 🚩 ♻️'],
];

const GROUPS = EMOJI_GROUPS.map(([name, emojis]) => ({ name, emojis: emojis.split(' ') }));
const ALL = GROUPS.flatMap((group) => group.emojis);
const COLUMNS = 8;

interface EmojiPickerProps {
  value: string | null;
  onChange: (emoji: string | null) => void;
  disabled?: boolean;
  /** Renders the button that opens the picker. */
  children: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog'; disabled?: boolean }) => ReactNode;
  className?: string;
}

/** A small emoji palette, used for page icons. */
export function EmojiPicker({ value, onChange, disabled, children, className = '' }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const initial = value && ALL.includes(value) ? value : ALL[0];

  const choose = (emoji: string | null) => {
    setOpen(false);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    if (emoji !== value) onChange(emoji);
  };

  // Arrow keys move between emojis like in a grid.
  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  };

  return (
    <div ref={ref} className={`emoji-picker ${className}`}>
      {children({ onClick: () => setOpen((current) => !current), 'aria-expanded': open, 'aria-haspopup': 'dialog', disabled })}
      {open && (
        <div className="emoji-panel dropdown-panel" role="dialog" aria-label="Choose an icon">
          <div className="emoji-panel-header">
            <span>Choose an icon</span>
            <span className="emoji-panel-actions">
              <button type="button" className="btn btn-sm" onClick={() => choose(ALL[Math.floor(Math.random() * ALL.length)]!)}>
                Random
              </button>
              {value && (
                <button type="button" className="btn btn-sm" onClick={() => choose(null)}>
                  Remove
                </button>
              )}
            </span>
          </div>
          <div className="emoji-groups" ref={grid} onKeyDown={onGridKeyDown}>
            {GROUPS.map((group) => (
              <section key={group.name} aria-label={group.name}>
                <h3>{group.name}</h3>
                <div className="emoji-grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}>
                  {group.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      data-emoji={emoji}
                      className={emoji === value ? 'selected' : ''}
                      aria-label={emoji}
                      aria-pressed={emoji === value}
                      autoFocus={emoji === initial}
                      onClick={() => choose(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
