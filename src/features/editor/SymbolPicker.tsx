// The Symbol button and its panel: symbols, accents and structures to choose from, found by
// category or by searching, each shown as it will print. What is chosen is written the way the
// place it goes needs (see symbols.ts), into the text or into the table cell being worked on.
import katex from "katex";
import { useEffect, useMemo, useRef, useState } from "react";
import { buffers } from "./buffers";
import { CATEGORIES, type Sym, findSymbols, insertion, symbolId, symbolsById } from "./symbols";

const COLUMNS = 10;
const drawn = new Map<string, string>();

/** A symbol as it will print: typeset when it has a formula, else its character. */
function Glyph({ sym, big = false }: { sym: Sym; big?: boolean }) {
  const tex = sym.preview ?? sym.math;
  // Spaces print as nothing; their tile shows a sign for them instead.
  if (!tex || /^\\(?:,|quad)$/.test(tex)) return <span className="sym-text">{sym.glyph}</span>;
  let html = drawn.get(tex);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { throwOnError: true, output: "html" });
    } catch {
      html = "";
    }
    drawn.set(tex, html);
  }
  if (!html) return <span className="sym-text">{sym.glyph}</span>;
  return <span className={big ? "sym-tex big" : "sym-tex"} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** What is written for a symbol, in a formula and in text. */
function written(sym: Sym): { math: string; text: string } {
  const show = (ins: { before: string; after: string }) => (ins.after ? `${ins.before}…${ins.after}` : ins.before).trim();
  return { math: show(insertion(sym, true, " ")), text: show(insertion(sym, false, ".")) };
}

interface Props {
  open: boolean;
  disabled: boolean;
  /** The symbols used lately, most recent first. */
  recent: string[];
  onOpen: (open: boolean) => void;
  onUsed: (id: string) => void;
}

export function SymbolPicker(p: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(p.recent.length ? "recent" : CATEGORIES[0].id);
  const [shown, setShown] = useState<Sym | null>(null);
  const [focus, setFocus] = useState(0);
  /** The panel stays open after a symbol is put in, for writing several in a row. */
  const [keep, setKeep] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => symbolsById(p.recent), [p.recent]);

  useEffect(() => {
    if (!p.open) return;
    setQuery("");
    setFocus(0);
    search.current?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) p.onOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
    // Opening is what matters here; the handler only closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  const list = query.trim() ? findSymbols(query) : category === "recent" ? recent : (CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]).symbols;
  const about = shown ?? list[Math.min(focus, list.length - 1)] ?? null;

  const choose = (sym: Sym, stay = false) => {
    buffers.insertSymbol(sym);
    p.onUsed(symbolId(sym));
    if (!keep && !stay) p.onOpen(false);
  };
  const tile = (i: number) => grid.current?.querySelectorAll<HTMLButtonElement>("button")[i];
  const move = (to: number) => {
    const next = Math.max(0, Math.min(list.length - 1, to));
    setFocus(next);
    setShown(null);
    tile(next)?.focus();
  };
  const close = () => {
    p.onOpen(false);
    root.current?.querySelector<HTMLButtonElement>(".sym-btn")?.focus();
  };

  return (
    <div className="sym" ref={root}>
      <button
        className="ib sym-btn"
        aria-label="Insert symbol"
        title="Insert a symbol, accent or structure such as a fraction"
        aria-haspopup="dialog"
        aria-expanded={p.open}
        disabled={p.disabled}
        // The keyboard stays where it was, in the text or a table cell, until the panel opens.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => p.onOpen(!p.open)}
      >
        Ω
      </button>
      {p.open && (
        <div
          className="sym-pop"
          role="dialog"
          aria-label="Symbols"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <input
            ref={search}
            className="sym-search"
            type="search"
            placeholder="Search: alpha, arrow, ≤, fraction…"
            aria-label="Search symbols"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocus(0);
              setShown(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && list.length) {
                e.preventDefault();
                move(0);
              } else if (e.key === "Enter" && list.length) {
                e.preventDefault();
                choose(list[0], e.shiftKey);
              }
            }}
          />
          <label className="sym-keep" title="Leave the panel open after a symbol is put in. Shift+click does this for one symbol.">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Keep open
          </label>
          {!query.trim() && (
            <div className="sym-cats" role="tablist" aria-label="Kinds of symbol">
              {[{ id: "recent", label: "Recent" }, ...CATEGORIES].map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={category === c.id}
                  className={category === c.id ? "on" : ""}
                  onClick={() => {
                    setCategory(c.id);
                    setFocus(0);
                    setShown(null);
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div
            ref={grid}
            className="sym-grid"
            role="listbox"
            aria-label={query.trim() ? "Symbols found" : "Symbols"}
            style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
            onKeyDown={(e) => {
              const at = focus;
              const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS, Home: -at, End: list.length } as Record<string, number>;
              if (e.key in step) {
                e.preventDefault();
                if (e.key === "ArrowUp" && at < COLUMNS) search.current?.focus();
                else move(at + step[e.key]);
              } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Typing goes to the search box.
                search.current?.focus();
              }
            }}
          >
            {list.map((sym, i) => (
              <button
                key={symbolId(sym)}
                role="option"
                aria-selected={i === focus}
                tabIndex={i === focus ? 0 : -1}
                aria-label={sym.name}
                title={`${sym.name}: ${written(sym).math}`}
                onMouseEnter={() => setShown(sym)}
                onMouseLeave={() => setShown(null)}
                onFocus={() => setFocus(i)}
                onClick={(e) => choose(sym, e.shiftKey)}
              >
                <Glyph sym={sym} />
              </button>
            ))}
            {list.length === 0 && (
              <p className="sym-none">{query.trim() ? "Nothing matches. Try a name such as “arrow” or a command such as \\leq." : "Symbols you use will appear here."}</p>
            )}
          </div>
          {about && (
            <div className="sym-about" aria-live="polite">
              <div className="sym-big" aria-hidden="true">
                <Glyph sym={about} big />
              </div>
              <div>
                <b>{about.name[0].toUpperCase() + about.name.slice(1)}</b>
                <div>
                  In a formula <code>{written(about).math}</code>
                </div>
                <div>
                  In text <code>{written(about).text}</code>
                </div>
                {about.pkg && <div className="sym-pkg">Needs the {about.pkg} package; it is added to the preamble for you.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
