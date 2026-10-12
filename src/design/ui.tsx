// Shared building blocks. Looks come from design/base.css; these add the behaviour and semantics.
import { type ReactNode, useEffect, useRef, useState } from "react";

export type IconName =
  | "file" | "newfile" | "folder" | "search" | "review" | "history" | "help" | "gear" | "up"
  | "down" | "x" | "undo" | "redo" | "table" | "layout" | "chev" | "chevup" | "left" | "right"
  | "log" | "play" | "plus" | "check" | "edit" | "trash";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="ic" style={{ width: size, height: size }} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** The Emquad mark: the quad, holding the visible-space bracket. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="4" y="4" width="56" height="56" rx="11" fill="#141414" />
      <path d="M19 32v12h26V32" fill="none" stroke="#FF4D00" strokeWidth="5.5" strokeLinecap="square" />
    </svg>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** A button that opens a small list of actions below it. `separator` rows are drawn as rules. */
export function Menu({
  label,
  items,
  className = "menu",
  ariaLabel,
}: {
  label: ReactNode;
  items: (MenuItem | "separator")[];
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} className="menu-sep" role="separator" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                className="menu-item"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A modal on the native dialog element: focus is trapped and Escape closes it. */
export function Dialog({
  title,
  intro,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  intro?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : undefined}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dlg">
        <div>
          <h2>{title}</h2>
          {intro && <p>{intro}</p>}
        </div>
        {children}
      </div>
    </dialog>
  );
}
