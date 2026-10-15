// The equation editor, as Word has it: the formula is typed and shown as it prints, with a
// ribbon of structures and symbols, and boxes to fill in. The editing is MathLive's; what goes
// into the document is plain LaTeX.
import { useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";
import { Dialog } from "../design/ui";
import { applyFormula, formulaHere } from "./actions";
import type { Formula, Placement } from "../features/editor/equation";
import { STRUCTURES, SYMBOL_GROUPS, cleanFormula, preview, withNewLine } from "../features/editor/equationRibbon";
import { typeset } from "../features/editor/inlineTex";

/** MathLive, loaded when the editor first opens: it is large, and most sessions never need it. */
let loading: Promise<typeof import("mathlive")> | null = null;
function mathlive() {
  loading ??= import("mathlive").then((m) => {
    // Its fonts are KaTeX's, which the app has with it already: nothing is fetched, ever. And
    // it makes no sounds.
    m.MathfieldElement.fontsDirectory = null;
    m.MathfieldElement.soundsDirectory = null;
    return m;
  });
  return loading;
}

/** A piece of LaTeX drawn as it prints, for a button. */
function Typeset({ tex }: { tex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.textContent = "";
    typeset(ref.current, tex, false);
  }, [tex]);
  return <span ref={ref} className="eq-shown" aria-hidden="true" />;
}

const PLACEMENTS: [Placement, string, string][] = [
  ["inline", "In the line of text", "like this: x²"],
  ["display", "On a line of its own", "centred"],
  ["numbered", "On a line of its own, numbered", "(1), to refer to"],
];

export function EquationDialog({ onClose }: { onClose: () => void }) {
  const [was] = useState<Formula | null>(() => formulaHere());
  const [placement, setPlacement] = useState<Placement>(was?.placement ?? "inline");
  const [source, setSource] = useState(was?.tex ?? "");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [symbols, setSymbols] = useState(SYMBOL_GROUPS[0].id);
  const holder = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  /** The formula as the editor read it on opening, to tell whether it was changed at all. */
  const opened = useRef("");
  /** The LaTeX under the formula was typed in last: it goes in as it was typed. */
  const [typedSource, setTypedSource] = useState(false);
  /** The button of each group of the ribbon, to give the keyboard back to when its list closes. */
  const toolButtons = useRef(new Map<string, HTMLButtonElement>());

  /**
   * What goes into the document: the formula as it was when nothing in it was changed, the
   * LaTeX as typed when it was typed last, and otherwise what the editor writes, made LaTeX.
   */
  const formula = () => {
    if (typedSource) return source.trim();
    const latex = field.current?.getValue("latex") ?? source;
    if (was && latex === opened.current) return was.tex;
    return cleanFormula(latex);
  };
  const empty = !cleanFormula(source).replace(/\{\}/g, "").trim();
  const apply = () => {
    const tex = formula();
    if (tex) void applyFormula(tex, placement, was);
  };
  /** Close a ribbon list, the keyboard going back to its button when it was in the list. */
  const closeList = (refocus: boolean) => {
    if (refocus && open) toolButtons.current.get(open)?.focus();
    setOpen(null);
  };

  useEffect(() => {
    let gone = false;
    void mathlive().then(({ MathfieldElement }) => {
      if (gone || !holder.current) return;
      const mf = new MathfieldElement();
      mf.className = "eq-field";
      mf.setAttribute("aria-label", "Formula");
      mf.mathVirtualKeyboardPolicy = "manual";
      mf.smartFence = true;
      mf.popoverPolicy = "off";
      mf.value = was?.tex ?? "";
      mf.addEventListener("input", () => {
        setSource(mf.getValue("latex"));
        setTypedSource(false);
      });
      holder.current.append(mf);
      // Once it is in the page: its right-click menu offers colours and decorations that need
      // packages or are not LaTeX at all.
      mf.menuItems = [];
      opened.current = mf.getValue("latex");
      field.current = mf;
      setReady(true);
      requestAnimationFrame(() => mf.focus());
    });
    return () => {
      gone = true;
      field.current?.remove();
      field.current = null;
    };
    // Made once, for the formula the dialog opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Write `insert` where the cursor is in the formula, around what is selected there. */
  const put = (insert: string, after = false) => {
    const mf = field.current;
    if (!mf) return;
    mf.insert(insert, { selectionMode: after ? "after" : "placeholder", focus: true, format: "latex" });
    setSource(mf.getValue("latex"));
    setTypedSource(false);
    setOpen(null);
  };

  /** Start a new line below, lined up with the others at their =, as Enter does in Word. */
  const newLine = () => {
    const mf = field.current;
    if (!mf) return;
    mf.value = withNewLine(mf.getValue("latex")).replace(/#\?/g, "\\placeholder{}");
    // Into the new line's box, after its &: the last place inside the lines.
    mf.executeCommand("moveToMathfieldEnd");
    mf.executeCommand("moveToPreviousChar");
    mf.focus();
    setSource(mf.getValue("latex"));
    setTypedSource(false);
    if (placement === "inline") setPlacement("display");
  };

  const shownSymbols = SYMBOL_GROUPS.find((g) => g.id === symbols)?.symbols ?? [];

  return (
    <Dialog
      title={was ? "Change equation" : "Equation"}
      intro="Type as in Word: / makes a fraction, ^ a power, _ an index, and names such as alpha, sqrt or sum become what they name. Tab moves to the next box."
      onClose={onClose}
      wide
    >
      <form
        className="dlg eq"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        onKeyDownCapture={(e) => {
          // Ctrl+Enter puts it in; Shift+Enter starts a new line, as in Word.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            apply();
          } else if (e.key === "Enter" && e.shiftKey && e.target === field.current) {
            e.preventDefault();
            e.stopPropagation();
            newLine();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            closeList(true);
          } else if (e.key === "Escape" && e.target === field.current && field.current?.mode !== "latex") {
            // The formula takes Esc for itself; outside its LaTeX typing, Esc closes the dialog
            // as it does every other.
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="eq-ribbon" role="group" aria-label="Structures">
          {STRUCTURES.map((g) => (
            <div
              className="eq-group"
              key={g.id}
              onBlur={(e) => {
                // A list closes when the keyboard leaves it, or its button, for elsewhere.
                if (open === g.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null);
              }}
            >
              <button
                type="button"
                ref={(b) => {
                  if (b) toolButtons.current.set(g.id, b);
                }}
                className={`btn eq-tool${open === g.id ? " on" : ""}`}
                aria-expanded={open === g.id}
                title={g.label}
                disabled={!ready}
                onClick={() => setOpen(open === g.id ? null : g.id)}
              >
                <Typeset tex={g.icon} />
                <span className="eq-label">{g.label}</span>
              </button>
              {open === g.id && (
                <div className="eq-pop" role="group" aria-label={g.label}>
                  {g.items.map((item, i) => (
                    <button
                      key={item.name}
                      type="button"
                      className="eq-item"
                      title={item.name}
                      aria-label={item.name}
                      autoFocus={i === 0}
                      onClick={() => put(item.insert)}
                    >
                      <Typeset tex={preview(item.insert)} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn eq-tool" title="New line below, lined up at = (Shift+Enter)" disabled={!ready} onClick={newLine}>
            <span className="eq-shown eq-newline" aria-hidden="true">↵</span>
            <span className="eq-label">New line</span>
          </button>
        </div>
        <div className="eq-symbols">
          <label htmlFor="eq-symbol-kind" className="sr">
            Kind of symbol
          </label>
          <select id="eq-symbol-kind" value={symbols} onChange={(e) => setSymbols(e.target.value)}>
            {SYMBOL_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <div className="eq-symbol-row" role="group" aria-label="Symbols">
            {shownSymbols.map((s) => (
              <button key={s.math} type="button" className="eq-sym" title={`${s.name}, ${s.math}`} aria-label={s.name} disabled={!ready} onClick={() => put(s.math!, true)}>
                {s.glyph || <Typeset tex={s.math!} />}
              </button>
            ))}
          </div>
        </div>
        <div ref={holder} className="eq-holder">
          {!ready && <p>Opening the equation editor…</p>}
        </div>
        <details className="eq-source">
          <summary>LaTeX</summary>
          <label htmlFor="eq-tex" className="sr">
            The formula in LaTeX
          </label>
          <textarea
            id="eq-tex"
            rows={2}
            spellCheck={false}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setTypedSource(true);
              if (field.current) field.current.value = e.target.value;
            }}
          />
        </details>
        <fieldset>
          <legend>Set it</legend>
          {PLACEMENTS.map(([value, label, note]) => (
            <label className="ck" key={value}>
              <input id={`eq-${value}`} type="radio" name="eq-placement" checked={placement === value} onChange={() => setPlacement(value)} />
              <span>{label}</span>
              <small>{note}</small>
            </label>
          ))}
        </fieldset>
        <div className="end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn go" disabled={!ready || empty}>
            {was ? "Change" : "Insert"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
