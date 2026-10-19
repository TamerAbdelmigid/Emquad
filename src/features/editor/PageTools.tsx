// What the page view adds around the text, as a word processor does: a small toolbar over a
// selection made with the mouse, a right-click menu, and the format painter's second half (the
// text selected next is given the formatting it copied).
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName, Menu } from "../../design/ui";
import { useStore } from "../../state/store";
import { colourItems } from "./Ribbon";
import { buffers } from "./buffers";
import { toggleReveal } from "./visual";

interface Props {
  /** The element the editor is in. */
  host: React.RefObject<HTMLDivElement | null>;
  onComment: () => void;
}

/** A button of the small toolbar or the menu: named, with its keys in its title. */
function Key(p: { name: string; keys?: string; icon?: IconName; glyph?: ReactNode; run: () => void }) {
  return (
    <button type="button" className="rb-tool glyph" aria-label={p.name} title={p.keys ? `${p.name} (${p.keys})` : p.name} onMouseDown={(e) => e.preventDefault()} onClick={p.run}>
      {p.icon ? <Icon name={p.icon} /> : p.glyph}
    </button>
  );
}

export function PageTools({ host, onComment }: Props) {
  const selecting = useStore((s) => s.selecting);
  const painting = useStore((s) => s.painting);
  const [bar, setBar] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The toolbar shows over a selection made with the mouse, and goes when a key is pressed, the
  // page scrolls or nothing is selected.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const up = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target as Element).closest?.(".cm-content")) return;
      // After the editor has taken the selection in.
      setTimeout(() => {
        if (buffers.paint()) return setBar(null);
        const box = buffers.selectionBox();
        setBar(box ? { x: (box.left + box.right) / 2, y: box.top } : null);
      }, 0);
    };
    const key = (e: KeyboardEvent) => {
      setBar(null);
      if (e.key === "Escape" && useStore.getState().painting) buffers.stopPainting();
    };
    // Shift and the arrow keys select: letting go of Shift gives the painter's formatting.
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && useStore.getState().painting) buffers.paint();
    };
    const away = () => setBar(null);
    const context = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".cm-content")) return;
      e.preventDefault();
      // A right-click outside the selection puts the cursor where it was made, as in Word.
      buffers.placeCursorUnlessSelected(e.clientX, e.clientY);
      const box = e.clientX || e.clientY ? null : buffers.selectionBox() ?? buffers.cursorBox();
      setBar(null);
      setMenu(box ? { x: box.left, y: box.bottom + 4 } : { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("mouseup", up);
    el.addEventListener("keydown", key, true);
    el.addEventListener("keyup", keyUp, true);
    el.addEventListener("contextmenu", context);
    const scroller = el.querySelector(".cm-scroller");
    scroller?.addEventListener("scroll", away, { passive: true });
    return () => {
      el.removeEventListener("mouseup", up);
      el.removeEventListener("keydown", key, true);
      el.removeEventListener("keyup", keyUp, true);
      el.removeEventListener("contextmenu", context);
      scroller?.removeEventListener("scroll", away);
    };
  }, [host]);

  useEffect(() => {
    if (!selecting) setBar(null);
  }, [selecting]);

  // The pointer shows that the painter holds formatting.
  useEffect(() => {
    host.current?.classList.toggle("painting", painting);
  }, [host, painting]);

  // The menu takes the keyboard while it is open, and gives it back to the text when it closes.
  useEffect(() => {
    if (!menu) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    items()[0]?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
      if (e instanceof KeyboardEvent) buffers.run(() => true);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const act = (run: () => void) => () => {
    setMenu(null);
    run();
  };
  const entries: ({ name: string; keys?: string; run: () => void } | "separator")[] = [
    { name: "Cut", keys: "Ctrl+X", run: () => buffers.clipboard("cut") },
    { name: "Copy", keys: "Ctrl+C", run: () => buffers.clipboard("copy") },
    { name: "Paste", keys: "Ctrl+V", run: () => void buffers.paste(false) },
    { name: "Paste words only", keys: "Ctrl+Shift+V", run: () => void buffers.paste(true) },
    "separator",
    { name: "New comment", keys: "Ctrl+Alt+M", run: onComment },
    "separator",
    { name: "Show LaTeX", keys: "Ctrl+/", run: () => buffers.run(toggleReveal) },
  ];

  return (
    <>
      {bar && (
        <div className="page-bar" role="toolbar" aria-label="Format the selection" style={{ left: bar.x, top: bar.y }}>
          <Key name="Bold" keys="Ctrl+B" glyph={<b>B</b>} run={() => buffers.format("textbf")} />
          <Key name="Italic" keys="Ctrl+I" glyph={<i>I</i>} run={() => buffers.format("textit")} />
          <Key name="Underline" keys="Ctrl+U" glyph={<u>U</u>} run={() => buffers.format("underline")} />
          <Key name="Highlight" icon="hl" run={() => buffers.format("hl")} />
          <Menu className="rb-tool rb-colour" ariaLabel="Font colour" label={<>A<Icon name="chev" size={10} /></>} items={colourItems()} />
          <Key name="Clear formatting" icon="clear" run={() => buffers.clearFormatting()} />
          <span className="page-bar-sep" />
          <Key name="Comment" keys="Ctrl+Alt+M" icon="comment" run={onComment} />
          <Key name="Show LaTeX" keys="Ctrl+/" icon="code" run={() => buffers.run(toggleReveal)} />
        </div>
      )}
      {menu && (
        <div className="page-menu menu-list" role="menu" aria-label="Edit" ref={menuRef} style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            const all = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            all[(to + all.length) % all.length]?.focus();
          }}
        >
          {entries.map((entry, i) =>
            entry === "separator" ? (
              <div key={i} className="menu-sep" role="separator" />
            ) : (
              <button key={entry.name} type="button" role="menuitem" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={act(entry.run)}>
                <span>{entry.name}</span>
                {entry.keys && <kbd>{entry.keys}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
      {painting && <div className="page-painting" role="status">Format painter: select the text to format. Esc stops.</div>}
    </>
  );
}
