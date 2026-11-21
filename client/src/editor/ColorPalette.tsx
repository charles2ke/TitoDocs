import { useId } from 'react';
import { Check } from 'lucide-react';

/** Rows of a 10-column palette: grays, saturated colors, then lighter and darker shades. */
const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
];

interface ColorPaletteProps {
  label: string;
  value: string | null;
  /** `final` is false while a custom color is still being chosen. */
  onPick: (color: string, final: boolean) => void;
  onReset: () => void;
  resetLabel: string;
}

export function ColorPalette({ label, value, onPick, onReset, resetLabel }: ColorPaletteProps) {
  const customId = useId();
  const current = value?.toLowerCase() ?? null;
  return (
    <div className="color-palette" role="group" aria-label={label}>
      <button type="button" className="btn btn-sm color-reset" onMouseDown={(event) => event.preventDefault()} onClick={onReset}>
        {resetLabel}
      </button>
      <div className="color-grid">
        {PALETTE.flat().map((color) => (
          <button
            key={color}
            type="button"
            className="color-swatch"
            style={{ background: color }}
            aria-label={color}
            aria-pressed={current === color}
            title={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(color, true)}
          >
            {current === color && <Check size={12} />}
          </button>
        ))}
      </div>
      <label className="color-custom" htmlFor={customId}>
        Custom color
        <input
          id={customId}
          type="color"
          value={current && /^#[0-9a-f]{6}$/.test(current) ? current : '#000000'}
          onChange={(event) => onPick(event.target.value, false)}
        />
      </label>
    </div>
  );
}
