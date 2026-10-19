// The table button: a grid to choose how many rows and columns a new table has.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/ui";
import { buffers } from "./buffers";
import { newTable, writeTable } from "./tableModel";

const PICK_ROWS = 8;
const PICK_COLS = 10;

/** The table button: opens a grid to choose how many rows and columns the new table has. */
export function TablePicker({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState({ rows: 2, cols: 2 });
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    grid.current?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  const insert = (rows: number, cols: number) => {
    setOpen(false);
    buffers.insert(`${writeTable(newTable(rows, cols))}\n`);
  };
  const fit = (rows: number, cols: number) => ({ rows: Math.max(1, Math.min(PICK_ROWS, rows)), cols: Math.max(1, Math.min(PICK_COLS, cols)) });
  const grow = (rows: number, cols: number) => setSize((now) => fit(now.rows + rows, now.cols + cols));
  return (
    <div className="tpick" ref={root}>
      <button className="ib" aria-label="Insert table" title="Insert table" aria-haspopup="true" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <Icon name="table" />
      </button>
      {open && (
        <div className="tpick-pop">
          <div
            ref={grid}
            className="tpick-grid"
            tabIndex={0}
            role="application"
            aria-label={`New table: ${size.rows} rows by ${size.cols} columns. Arrow keys change the size, Enter inserts it.`}
            style={{ gridTemplateColumns: `repeat(${PICK_COLS}, 16px)` }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "Enter" || e.key === " ") insert(size.rows, size.cols);
              else if (e.key === "ArrowRight") grow(0, 1);
              else if (e.key === "ArrowLeft") grow(0, -1);
              else if (e.key === "ArrowDown") grow(1, 0);
              else if (e.key === "ArrowUp") grow(-1, 0);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseMove={(e) => {
              const at = (e.target as HTMLElement).dataset;
              if (at.r && at.c) setSize(fit(Number(at.r), Number(at.c)));
            }}
            onMouseUp={(e) => {
              const at = (e.target as HTMLElement).dataset;
              if (at.r && at.c) insert(Number(at.r), Number(at.c));
            }}
          >
            {Array.from({ length: PICK_ROWS * PICK_COLS }, (_, i) => {
              const [r, c] = [Math.floor(i / PICK_COLS) + 1, (i % PICK_COLS) + 1];
              return <i key={i} data-r={r} data-c={c} className={r <= size.rows && c <= size.cols ? "on" : ""} />;
            })}
          </div>
          <div className="tpick-size" aria-hidden="true">
            {size.rows} × {size.cols} table
          </div>
        </div>
      )}
    </div>
  );
}
