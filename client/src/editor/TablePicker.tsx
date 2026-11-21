import { useState, type KeyboardEvent } from 'react';

const COLUMNS = 10;
const ROWS = 8;

/** Insert ▸ Table: hover (or use the arrow keys) to choose the size of the new table. */
export function TablePicker({ onPick }: { onPick: (rows: number, columns: number) => void }) {
  const [size, setSize] = useState({ rows: 1, columns: 1 });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    const move = moves[event.key];
    if (move) {
      // At the left edge, let the menu handle ArrowLeft (back to the parent menu).
      if (event.key === 'ArrowLeft' && size.columns === 1) return;
      event.preventDefault();
      event.stopPropagation();
      setSize(({ rows, columns }) => ({
        rows: Math.min(ROWS, Math.max(1, rows + move[0])),
        columns: Math.min(COLUMNS, Math.max(1, columns + move[1])),
      }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onPick(size.rows, size.columns);
    }
  };

  return (
    <div className="table-picker">
      <div
        role="menuitem"
        tabIndex={-1}
        className="table-picker-grid"
        aria-label={`Insert a table with ${size.rows} ${size.rows === 1 ? 'row' : 'rows'} and ${size.columns} ${size.columns === 1 ? 'column' : 'columns'}`}
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
        onKeyDown={onKeyDown}
        data-testid="table-picker"
      >
        {Array.from({ length: ROWS * COLUMNS }, (_, index) => {
          const row = Math.floor(index / COLUMNS) + 1;
          const column = (index % COLUMNS) + 1;
          return (
            <span
              key={index}
              className={`table-picker-cell ${row <= size.rows && column <= size.columns ? 'selected' : ''}`}
              onPointerEnter={() => setSize({ rows: row, columns: column })}
              onClick={() => onPick(row, column)}
            />
          );
        })}
      </div>
      <div className="table-picker-size" aria-hidden="true">
        {size.columns} × {size.rows}
      </div>
    </div>
  );
}
