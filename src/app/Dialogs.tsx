import { useEffect, useState } from "react";
import { Dialog } from "../design/ui";
import { type Engines, type PackagesInfo, api } from "../ipc/api";
import { useStore } from "../state/store";
import { applyFix, applySetup, applySpelling, createProject, currentSetup, exportBundle, guard, helpFor, openFile } from "./actions";
import type { Setup } from "../features/editor/documentSetup";

const TEMPLATES = [
  { id: "article", label: "Article", note: "A paper with abstract and sections" },
  { id: "report", label: "Report", note: "Chapters and a table of contents" },
  { id: "thesis", label: "Thesis", note: "Title page, abstract, contents, chapters and references" },
  { id: "exam", label: "Exam", note: "Header, name line and numbered questions" },
  { id: "letter", label: "Letter", note: "A formal letter" },
];

const THEMES = [
  { id: "fieldwork", label: "Fieldwork", note: "light instrument panels" },
  { id: "glass", label: "Glass", note: "frosted panels over a warm room" },
  { id: "onyx", label: "Onyx", note: "near-black with a green accent" },
];

const COMPILERS: { id: string; label: string; note: string; needs: "tectonic" | "latexmk" | null }[] = [
  { id: "auto", label: "Automatic", note: "Tectonic, or latexmk if it is missing", needs: null },
  { id: "tectonic", label: "Tectonic", note: "built in; fetches packages as needed", needs: "tectonic" },
  { id: "latexmk", label: "latexmk", note: "your own TeX installation; for pdfTeX-only documents", needs: "latexmk" },
];

const SPELLING = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "fr", label: "French" },
  { id: "es", label: "Spanish" },
  { id: "nl", label: "Dutch" },
  { id: "ru", label: "Russian" },
  { id: "off", label: "Off" },
];

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`;

const SHORTCUTS: [string, string][] = [
  ["Recompile", "Ctrl+Enter"],
  ["Save (and recompile, when compile on save is on)", "Ctrl+S"],
  ["Bold, italic, underline", "Ctrl+B, Ctrl+I, Ctrl+U"],
  ["Go to this place in the PDF", "Ctrl+Alt+J"],
  ["Go to the source", "Double-click in the PDF"],
  ["Find and replace", "Ctrl+F"],
  ["Search the project", "Ctrl+Shift+F"],
  ["Comment on the selected text", "Ctrl+Alt+M"],
  ["In a table: next or previous cell", "Tab, Shift+Tab"],
  ["In a table: select cells", "Shift+arrow keys"],
  ["In a table: open its menu", "Shift+F10"],
  ["In a table: select the whole table", "Ctrl+A"],
  ["In a table: copy, cut, paste cells", "Ctrl+C, Ctrl+X, Ctrl+V"],
  ["Correct the misspelled word at the cursor", "Ctrl+."],
  ["Go to definition (with texlab)", "F12"],
  ["Find references (with texlab)", "Shift+F12"],
  ["Rename a label or command (with texlab)", "F2"],
  ["Leave the editor with the keyboard", "Esc, then Tab"],
  ["Show or hide the file panel", "Ctrl+Shift+B"],
  ["Save snapshot", "Ctrl+Shift+S"],
  ["Open History", "Ctrl+Shift+H"],
  ["Export bundle", "Ctrl+Shift+E"],
  ["Import bundle", "Ctrl+Shift+I"],
  ["New window, for another project", "Ctrl+Shift+N"],
];

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const ask = useStore((s) => s.ask);
  const set = useStore((s) => s.set);
  const close = () => set({ dialog: null });
  return (
    <>
      {dialog === "export" && <ExportDialog onClose={close} />}
      {dialog === "newProject" && <NewProjectDialog onClose={close} />}
      {dialog === "logs" && <LogsDialog onClose={close} />}
      {dialog === "settings" && <SettingsDialog onClose={close} />}
      {dialog === "setup" && <SetupDialog onClose={close} />}
      {dialog === "shortcuts" && (
        <Dialog title="Keyboard shortcuts" onClose={close}>
          <dl className="keys">
            {SHORTCUTS.map(([what, keys]) => (
              <div key={what}>
                <dt>{what}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
          <div className="end">
            <button className="btn" onClick={close}>
              Close
            </button>
          </div>
        </Dialog>
      )}
      {ask && <AskDialog key={ask.title} />}
    </>
  );
}

function AskDialog() {
  const ask = useStore((s) => s.ask)!;
  const set = useStore((s) => s.set);
  const [value, setValue] = useState(ask.value ?? "");
  const answer = (result: string | null) => {
    set({ ask: null });
    ask.resolve(result);
  };
  const isPrompt = ask.value !== undefined;
  return (
    <Dialog title={ask.title} intro={ask.message} onClose={() => answer(null)}>
      <form
        className="dlg"
        onSubmit={(e) => {
          e.preventDefault();
          answer(isPrompt ? value : "yes");
        }}
      >
        {isPrompt && (
          <div className="f">
            <label htmlFor="ask-value" className="sr">
              {ask.title}
            </label>
            <input id="ask-value" type="text" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
        <div className="end">
          <button type="button" className="btn" onClick={() => answer(null)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${ask.danger ? "dark" : "go"}`} autoFocus={!isPrompt}>
            {ask.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const hasPdf = useStore((s) => !!s.build?.hasPdf || s.pdfVersion > 0);
  const [note, setNote] = useState("");
  const [includePdf, setIncludePdf] = useState(true);
  const comments = useStore((s) => s.comments.length);
  const [includeComments, setIncludeComments] = useState(true);
  const [packages, setPackages] = useState<PackagesInfo | null>(null);
  const [includePackages, setIncludePackages] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void guard(async () => setPackages(await api.packagesInfo()));
  }, []);
  return (
    <Dialog title="Export bundle" intro="One file. Opens in Emquad on any computer, ready to continue." onClose={onClose}>
      <form
        className="dlg"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const include = { pdf: includePdf && hasPdf, packages: includePackages && !!packages?.available, comments: includeComments && comments > 0 };
          void exportBundle(note, include).finally(() => setBusy(false));
        }}
      >
        <fieldset>
          <legend>Included</legend>
          <label className="ck">
            <input id="inc-src" type="checkbox" checked disabled readOnly />
            <span>Sources and figures</span>
            <small>always</small>
          </label>
          <label className="ck">
            <input id="inc-hist" type="checkbox" checked disabled readOnly />
            <span>Changes and snapshots</span>
            <small>needed to merge the reply</small>
          </label>
          <label className="ck">
            <input id="inc-pdf" type="checkbox" checked={includePdf && hasPdf} disabled={!hasPdf} onChange={(e) => setIncludePdf(e.target.checked)} />
            <span>Compiled PDF</span>
            <small>{hasPdf ? "readable without Emquad" : "compile first to include it"}</small>
          </label>
          <label className="ck">
            <input id="inc-comments" type="checkbox" checked={includeComments && comments > 0} disabled={comments === 0} onChange={(e) => setIncludeComments(e.target.checked)} />
            <span>Comments</span>
            <small>{comments > 0 ? "with their replies" : "there are none yet"}</small>
          </label>
          <label className="ck">
            <input
              id="inc-packages"
              type="checkbox"
              checked={includePackages && !!packages?.available}
              disabled={!packages?.available}
              onChange={(e) => setIncludePackages(e.target.checked)}
            />
            <span>LaTeX packages</span>
            <small>
              {packages?.available
                ? `compiles with no internet; adds up to ${megabytes(packages.bytes)}`
                : "compile once with the built-in compiler to include them"}
            </small>
          </label>
        </fieldset>
        <div className="f">
          <label htmlFor="note">Note to the recipient</label>
          <textarea id="note" rows={3} placeholder="What changed, and what to look at" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn go" disabled={busy}>
            {busy ? (includePackages ? "Checking it compiles offline…" : "Exporting…") : "Choose where to save…"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const MARGINS = [
  { value: "", label: "As the document class sets them" },
  { value: "1.5cm", label: "Narrow, 1.5 cm" },
  { value: "2.5cm", label: "Normal, 2.5 cm" },
  { value: "3.5cm", label: "Wide, 3.5 cm" },
];

/** The page the document is set on, as a word processor's page setup shows it. */
function SetupDialog({ onClose }: { onClose: () => void }) {
  const [setup, setSetup] = useState<Setup | null | undefined>(undefined);
  useEffect(() => {
    void currentSetup().then(setSetup);
  }, []);
  const change = (part: Partial<Setup>) => setSetup((s) => (s ? { ...s, ...part } : s));
  const choice = (id: string, label: string, value: string, options: { value: string; label: string }[], set: (v: string) => void) => (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <Dialog title="Document setup" intro="The page your document is set on. Emquad writes the LaTeX for each setting at the top of the main file." onClose={onClose}>
      {setup === undefined && <p>Reading the document…</p>}
      {setup === null && <p>The main file has no settings of its own to change (no \documentclass before \begin{"{"}document{"}"}).</p>}
      {setup && (
        <form
          className="dlg"
          onSubmit={(e) => {
            e.preventDefault();
            void applySetup(setup);
          }}
        >
          {choice("su-paper", "Paper", setup.paper, [
            { value: "", label: "As the document class sets it" },
            { value: "a4paper", label: "A4" },
            { value: "letterpaper", label: "US Letter" },
          ], (paper) => change({ paper }))}
          {choice("su-size", "Size of the text", setup.size, [
            { value: "", label: "As the document class sets it (usually 10 pt)" },
            { value: "10pt", label: "10 pt" },
            { value: "11pt", label: "11 pt" },
            { value: "12pt", label: "12 pt" },
          ], (size) => change({ size }))}
          {choice("su-margins", "Margins", setup.margins, MARGINS.some((m) => m.value === setup.margins) ? MARGINS : [...MARGINS, { value: setup.margins, label: setup.margins }], (margins) => change({ margins }))}
          {choice("su-spacing", "Line spacing", setup.spacing, [
            { value: "single", label: "Single" },
            { value: "onehalf", label: "1.5 lines" },
            { value: "double", label: "Double" },
          ], (spacing) => change({ spacing: spacing as Setup["spacing"] }))}
          {choice("su-font", "Typeface", setup.font, [
            { value: "default", label: "Computer Modern, LaTeX's own" },
            { value: "times", label: "Times" },
            { value: "palatino", label: "Palatino" },
            { value: "sans", label: "Sans serif" },
          ], (font) => change({ font: font as Setup["font"] }))}
          {choice("su-paragraphs", "Paragraphs", setup.paragraphs, [
            { value: "indent", label: "First line indented" },
            { value: "space", label: "Space between, no indent" },
          ], (paragraphs) => change({ paragraphs: paragraphs as Setup["paragraphs"] }))}
          <label className="ck">
            <input type="checkbox" checked={setup.pageNumbers} onChange={(e) => change({ pageNumbers: e.target.checked })} />
            <span>Page numbers</span>
          </label>
          <div className="end">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn go">
              Apply
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("article");
  return (
    <Dialog title="New project" intro="Creates a folder with a starting document. You choose where next." onClose={onClose}>
      <form
        className="dlg"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void createProject(name.trim(), template);
        }}
      >
        <div className="f">
          <label htmlFor="np-name">Project name</label>
          <input id="np-name" type="text" autoFocus value={name} placeholder="my-paper" onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset>
          <legend>Start from</legend>
          {TEMPLATES.map((t) => (
            <label className="ck" key={t.id}>
              <input id={`tpl-${t.id}`} type="radio" name="template" checked={template === t.id} onChange={() => setTemplate(t.id)} />
              <span>{t.label}</span>
              <small>{t.note}</small>
            </label>
          ))}
        </fieldset>
        <div className="end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn go" disabled={!name.trim()}>
            Choose folder…
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LogsDialog({ onClose }: { onClose: () => void }) {
  const build = useStore((s) => s.build);
  const log = useStore((s) => s.log);
  const [raw, setRaw] = useState(false);
  const all = (build?.diagnostics ?? []).map((d) => ({ d, help: helpFor(d) }));
  // Notes on how the text is set (a line a little too wide) are kept apart, out of the way.
  const items = all.filter((x) => !x.help?.note);
  const notes = all.filter((x) => x.help?.note);
  const row = ({ d, help }: (typeof all)[number], i: number) => (
    <li key={i} className={help?.note ? "note" : d.severity}>
      <b>{help?.note ? "Note" : d.severity === "error" ? "Error" : "Warning"}</b>
      <span className="where">{d.line ? `${d.file}, line ${d.line}` : d.file}</span>
      <span className="said">{help ? help.text : d.message}</span>
      {help && <small className="latex-said">LaTeX says: {d.message}</small>}
      <span className="acts">
        {help?.fix && (
          <button className="btn" onClick={() => (onClose(), void applyFix(help.fix!))}>
            {help.fix.label}
          </button>
        )}
        {d.line > 0 && help?.fix?.kind !== "go" && (
          <button className="btn" onClick={() => (onClose(), void openFile(d.file, d.line))}>
            Go to line {d.line}
          </button>
        )}
      </span>
    </li>
  );
  return (
    <Dialog title="Logs and messages" onClose={onClose} wide>
      {!build && <p>Nothing has been compiled yet.</p>}
      {build && items.length === 0 && <p>The last compile finished with no errors or warnings.</p>}
      {items.length > 0 && <ul className="diags">{items.map(row)}</ul>}
      {notes.length > 0 && (
        <details className="diag-notes">
          <summary>
            {notes.length} {notes.length === 1 ? "note" : "notes"} on how the text is set, usually nothing to worry about
          </summary>
          <ul className="diags">{notes.map(row)}</ul>
        </details>
      )}
      {raw && <pre className="rawlog">{log.join("\n") || "No output was captured."}</pre>}
      <div className="end">
        <button className="btn" onClick={() => setRaw(!raw)}>
          {raw ? "Hide" : "Show"} full compiler output
        </button>
        <button className="btn go" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

/** The words the user has added to the dictionary, each with a way to take it out again. */
function OwnWords() {
  const words = useStore((s) => s.settings?.dictionary ?? []);
  const set = useStore((s) => s.set);
  if (!words.length) return <p className="own-words-empty">Words you add to the dictionary from the spelling menu are listed here.</p>;
  return (
    <div className="own-words">
      <span className="own-words-title">Your words</span>
      <ul aria-label="Words you added to the dictionary">
        {[...words].sort((a, b) => a.localeCompare(b)).map((word) => (
          <li key={word}>
            {word}
            <button
              type="button"
              aria-label={`Take ${word} out of the dictionary`}
              title="Take it out of the dictionary"
              onClick={() =>
                void guard(async () => {
                  set({ settings: await api.dictionaryRemove(word) });
                  await applySpelling();
                })
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsDialog({ onClose, firstRun = false }: { onClose: () => void; firstRun?: boolean }) {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const [name, setName] = useState(settings?.displayName ?? "");
  const [compileOnSave, setCompileOnSave] = useState(settings?.compileOnSave ?? true);
  const [fontSize, setFontSize] = useState(settings?.editorFontSize ?? 13);
  const [theme, setTheme] = useState(settings?.theme ?? "fieldwork");
  const [spellcheck, setSpellcheck] = useState(settings?.spellcheck ?? "en-US");
  const info = useStore((s) => s.info);
  const [projectSpelling, setProjectSpelling] = useState(info?.spellcheck ?? "");
  const [engine, setEngine] = useState(info?.engine ?? "auto");
  const [engines, setEngines] = useState<Engines | null>(null);
  useEffect(() => {
    void guard(async () => setEngines(await api.enginesAvailable()));
  }, []);
  useEffect(() => {
    if (settings && !name) setName(settings.displayName);
    // Only to pick up settings that arrive after the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  const submit = () =>
    guard(async () => {
      set({ settings: await api.settingsUpdate({ displayName: name, compileOnSave, editorFontSize: fontSize, theme, spellcheck }) });
      if (info && engine !== info.engine) set({ info: await api.projectSetEngine(engine) });
      if (info && projectSpelling !== info.spellcheck) set({ info: await api.projectSetSpellcheck(projectSpelling) });
      void applySpelling();
      onClose();
    });
  return (
    <Dialog
      title={firstRun ? "Welcome to Emquad" : "Settings"}
      intro={firstRun ? "Your name is attached to the snapshots and bundles you make, so collaborators can tell whose changes are whose. It stays on this computer and in the bundles you export." : undefined}
      onClose={firstRun ? () => {} : onClose}
    >
      <form
        className="dlg"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <div className="f">
          <label htmlFor="set-name">Your name</label>
          <input id="set-name" type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!firstRun && (
          <>
            <label className="ck">
              <input id="set-cos" type="checkbox" checked={compileOnSave} onChange={(e) => setCompileOnSave(e.target.checked)} />
              <span>Compile when saving</span>
              <small>Ctrl+S saves and recompiles</small>
            </label>
            <div className="f">
              <label htmlFor="set-font">Editor text size</label>
              <input id="set-font" type="number" min={9} max={28} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
            </div>
            <fieldset>
              <legend>Theme</legend>
              {THEMES.map((t) => (
                <label className="ck" key={t.id}>
                  <input id={`theme-${t.id}`} type="radio" name="theme" checked={theme === t.id} onChange={() => setTheme(t.id)} />
                  <span>{t.label}</span>
                  <small>{t.note}</small>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Spelling</legend>
              <div className="f">
                <label htmlFor="set-spell">Check spelling in</label>
                <select id="set-spell" value={spellcheck} onChange={(e) => setSpellcheck(e.target.value)}>
                  {SPELLING.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              {info && (
                <div className="f">
                  <label htmlFor="set-spell-project">For this project</label>
                  <select id="set-spell-project" value={projectSpelling} onChange={(e) => setProjectSpelling(e.target.value)}>
                    <option value="">The same as above</option>
                    {SPELLING.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <OwnWords />
            </fieldset>
            {info && (
              <fieldset>
                <legend>Compiler for this project</legend>
                {COMPILERS.map((c) => {
                  const missing = engines !== null && c.needs !== null && !engines[c.needs];
                  return (
                    <label className="ck" key={c.id}>
                      <input id={`eng-${c.id}`} type="radio" name="engine" checked={engine === c.id} disabled={missing && engine !== c.id} onChange={() => setEngine(c.id)} />
                      <span>{c.label}</span>
                      <small>{missing ? "not found on this computer" : c.note}</small>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </>
        )}
        <div className="end">
          {!firstRun && (
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn go" disabled={!name.trim()}>
            {firstRun ? "Continue" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
