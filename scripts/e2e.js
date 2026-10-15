// End-to-end check of the real app window. A debug build runs this file inside the page when
// EMQUAD_E2E points at it (see src-tauri/src/e2e.rs). From PowerShell, in the repository root:
//
//   $env:EMQUAD_E2E = "$PWD\scripts\e2e.js"
//   $env:EMQUAD_E2E_WORK = (New-Item -ItemType Directory "$env:TEMP\emquad-e2e-$(Get-Random)").FullName
//   $env:EMQUAD_E2E_OUT = "$env:EMQUAD_E2E_WORK\result.log"
//   pnpm tauri dev
//
// The app exits with code 0 when every check passes. It covers: compile, errors, source/PDF
// lookup, snapshot, export, opening a bundle as a new project, a merge with a conflict, spelling,
// visual mode, comments, references and citation styles, pictures dropped and pasted, text pasted
// with its formatting, the equation editor (typing, its ribbon, several lines, a double-click), PDFs with comments and changes on them, Send to Word
// (or, with no Pandoc, its refusal), and a bundle that carries its LaTeX packages.
// Zotero must not be running: one check asks for a citation from it and expects to be told it is not.
// Native file dialogs cannot be driven from a page, so those steps call the backend directly.
// Lines starting "SHOT" mark moments worth a screenshot; the script pauses briefly after each.
(async () => {
  if (window.__E2E_RUNNING) return;
  window.__E2E_RUNNING = true;
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const log = (line) => invoke("e2e_log", { line });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const text = (selector) => $(selector)?.textContent ?? "";
  let step = 0;

  async function until(what, check, timeout = 20000) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
      await sleep(100);
    }
  }
  async function ok(condition, what) {
    step += 1;
    if (!condition) throw new Error(`check ${step} failed: ${what}`);
    await log(`ok ${step} - ${what}`);
  }
  async function shot(name) {
    await sleep(500);
    await log(`SHOT ${name}`);
    await sleep(3000);
  }
  const button = (label) =>
    $$("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === label);
  const click = async (label) => (await until(`button "${label}"`, () => button(label))).click();
  /** Put text into a field the way typing does, so the page's own handlers see it. */
  const type = (field, value) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  /** Every control on screen must be a real, focusable control with a name. Returns the misses. */
  const audit = () => {
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const name = (el) =>
      (el.getAttribute("aria-label") ?? "").trim() ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()) ||
      el.closest("label")?.textContent.trim() ||
      (el.textContent ?? "").trim() ||
      (el.getAttribute("title") ?? "").trim() ||
      (el.getAttribute("placeholder") ?? "").trim();
    const misses = [];
    for (const el of $$("button, a[href], input, textarea, select, [role=separator][tabindex], [role=tab], [role=menuitem]")) {
      if (!visible(el) || el.closest(".cm-editor")) continue;
      const where = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
      if (!name(el)) misses.push(`${where} has no name`);
      if (el.tabIndex < 0 && !el.disabled) misses.push(`${where} cannot be reached with Tab`);
    }
    // Anything that reacts to a click must be one of the controls above.
    for (const el of $$("[onclick], div[role=button], span[role=button]")) misses.push(`${el.tagName.toLowerCase()} acts as a button`);
    return misses;
  };
  const status = (wanted, timeout = 180000) => until(`status "${wanted}"`, () => text(".proj .st") === wanted, timeout);

  const failures = [];
  window.addEventListener("error", (e) => failures.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => failures.push(String(e.reason?.message ?? e.reason)));

  try {
    const work = window.__E2E_WORK;
    if (!work) throw new Error("EMQUAD_E2E_WORK is not set");
    const { act, store } = await until("the app", () => window.emquad);
    // Write a file as another program would: the app's own writes are not reported back by its
    // file watcher, so the app is told of the change as the watcher would tell it.
    const writeOutside = async ({ path, text }) => {
      await invoke("file_write", { path, text });
      await act.filesChangedOnDisk([path]);
    };
    await invoke("settings_update", { displayName: "Tamer" });
    store().set({ settings: await invoke("settings_get") });
    await until("the start screen", () => $(".start"));
    await ok(!$("dialog[open]"), "with a name set, the welcome prompt does not appear");
    await shot("01-start");

    // --- a new project opens in the editor
    const a = await invoke("project_create", { parentDir: work, name: "e2e paper", template: "article" });
    await act.openProject(a.root);
    // A project opens in visual mode, its settings folded into one line, and is compiled at once.
    await until("the folded settings", () => $(".cm-v-fold"));
    await ok(text(".cm-v-fold").includes("e2e paper"), "a new project opens in visual mode, its settings folded into one line named by its title");
    await until("the first compile", () => store().build && !store().compiling, 120000);
    await ok(store().build.hasPdf, "a project never compiled is compiled as soon as it opens");
    await click("Code");
    await until("the editor", () => text(".cm-content").includes("\\documentclass"));
    await ok(true, "the main file is open in the editor");
    await ok(text(".file-row.on").includes("main.tex"), "the file tree marks the open file");
    await until("the outline", () => text(".flist.outline").includes("Introduction"));
    await ok(true, "the outline lists the section");

    // --- panels resize: by dragging the gap, and with the arrow keys
    const [filesGap, panesGap] = $$(".splitter");
    const panel = () => $(".files").getBoundingClientRect().width;
    const widthBefore = panel();
    const at = filesGap.getBoundingClientRect();
    const pointer = (type, x) =>
      filesGap.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: at.top + 40 }));
    pointer("pointerdown", at.left + 4);
    pointer("pointermove", at.left + 64);
    pointer("pointerup", at.left + 64);
    await until("the file panel to widen", () => panel() > widthBefore + 40);
    await ok(true, "dragging the gap widens the file panel");
    const sourceBefore = $(".screen").getBoundingClientRect().width;
    panesGap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await until("the source pane to narrow", () => $(".screen").getBoundingClientRect().width < sourceBefore - 5);
    await ok(true, "the arrow keys move the gap between source and PDF");

    // --- completion: from texlab when it is installed, from the built-in lists otherwise
    const withServer = store().languageServer;
    await ok(text(".sfoot").includes("texlab") === withServer, withServer ? "texlab is running for the project" : "without texlab the editor says nothing about it");
    {
      const { buffers: b } = await import("/src/features/editor/buffers.ts");
      b.goToLine(18);
      b.insert("\\sec");
      await click("Edit");
      (await until("the Suggest completions item", () => $$(".menu-item").find((i) => i.firstChild.textContent === "Suggest completions"))).click();
      await until("completion suggestions", () => text(".cm-tooltip-autocomplete").includes("section"), withServer ? 30000 : 8000);
      await ok(true, `completion offers \\section${withServer ? " through texlab" : ""}`);
      document.querySelector(".cm-content").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      // Put the buffer back as it is on disk, so the test text is not compiled.
      b.replace("main.tex", (await invoke("file_read", { path: "main.tex" })).text);
      await until("the buffer to be clean again", () => !$(".stab.on .dot"));
      if (withServer) {
        // Go to definition opens the file the definition is in, though it is not open.
        await writeOutside({ path: "defs.tex", text: "\\section{Defined}\\label{sec:defined}\n" });
        b.goToLine(18);
        b.insert("\\input{defs}\n\\ref{sec:def", "ined}\n");
        const f12 = () => $(".cm-content").dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true, cancelable: true }));
        let tries = 0;
        await until(
          "the file the label is defined in",
          () => {
            // Asked again every second and a half, while the server reads the new file.
            if (store().active !== "defs.tex" && tries++ % 15 === 0) f12();
            return store().active === "defs.tex";
          },
          40000,
        );
        await ok(text(".stab.on").includes("defs.tex"), "F12 on a reference opens the file its label is defined in");
        await act.closeTab("defs.tex");
        await invoke("file_delete", { path: "defs.tex" });
        await act.openFile("main.tex");
        b.replace("main.tex", (await invoke("file_read", { path: "main.tex" })).text);
        await until("the buffer to be clean again", () => !$(".stab.on .dot"));
      }
    }

    // --- compile
    await click("Recompile");
    await until("a rendered PDF page", () => $(".pdf-page canvas"), 180000);
    await status("Compiled");
    await ok(true, "Recompile produces a PDF and the status reads Compiled");
    await ok(document.documentElement.scrollHeight <= window.innerHeight, "the window does not scroll");
    await shot("02-editor");
    let misses = audit();
    await ok(misses.length === 0, `every control in the editor is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);

    // --- menus work from the keyboard
    const fileMenu = button("File");
    fileMenu.focus();
    fileMenu.click();
    await until("the menu to take focus", () => document.activeElement?.getAttribute("role") === "menuitem");
    const firstItem = document.activeElement;
    firstItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await ok(document.activeElement !== firstItem && document.activeElement.getAttribute("role") === "menuitem", "arrow keys move through a menu");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until("the menu to close", () => !$(".menu-list"));
    await ok(document.activeElement === fileMenu, "Escape closes the menu and returns focus to its button");

    // --- the other themes repaint the same layout
    const fieldworkPage = getComputedStyle(document.body).backgroundColor;
    for (const theme of ["onyx", "glass"]) {
      store().set({ settings: await invoke("settings_update", { theme }) });
      await until(`the ${theme} theme`, () => document.documentElement.dataset.theme === theme && getComputedStyle(document.body).backgroundColor !== fieldworkPage);
      await ok(getComputedStyle($(".files")).color !== "rgb(20, 20, 20)", `${theme} recolours the panels`);
      await ok(document.documentElement.scrollHeight <= window.innerHeight, `${theme} keeps the layout inside the window`);
      await shot(`02-${theme}`);
    }
    store().set({ settings: await invoke("settings_update", { theme: "fieldwork" }) });
    await until("the Fieldwork theme again", () => getComputedStyle(document.body).backgroundColor === fieldworkPage);

    const { buffers } = await import("/src/features/editor/buffers.ts");
    /** Edit, Undo: as the user would. */
    const undoText = async () => {
      await click("Edit");
      (await until("the Undo item", () => $$(".menu-item").find((i) => i.firstChild?.textContent === "Undo"))).click();
    };
    // --- visual mode draws the same source as a document, and code mode puts it back
    const plain = (await invoke("file_read", { path: "main.tex" })).text;
    const rich = plain.replace(
      "Start writing here.",
      "Start \\textbf{writing} here, with $E = mc^2$ inline.\n\\begin{equation}\n  I = \\int_0^\\infty e^{-x^2}\\,dx\n\\end{equation}\n\\begin{itemize}\n\\item first\n\\end{itemize}",
    );
    await writeOutside({ path: "main.tex", text: rich });
    await until("the richer document", () => text(".cm-content").includes("textbf"));
    buffers.goToLine(1);
    await click("Visual");
    await until("visual mode", () => $(".cm-visual .cm-v-h1") && $$(".cm-v-math .katex").length >= 2 && $(".cm-v-bullet"));
    await ok(!$(".cm-v-h1").textContent.includes("\\section"), "visual mode shows the section as a heading without its command");
    await ok($(".cm-v-display .katex") && !$(".cm-v-math-bad"), "and typesets inline and display mathematics");
    await ok(buffers.text("main.tex") === rich, "the source text itself is unchanged by visual mode");
    await shot("02-visual");
    await click("Code");
    await until("plain source again", () => !$(".cm-visual") && !$(".cm-v-math"));
    await ok(text(".cm-content").includes("\\begin{equation}"), "code mode shows the plain source again");
    await writeOutside({ path: "main.tex", text: plain });
    await until("the original document", () => !text(".cm-content").includes("textbf"));

    // --- search across the project
    await click("Search the project");
    type(await until("the search field", () => $("#search-query")), "introduction");
    const hit = await until("a search result", () => $(".search-hit"));
    await ok(text(".search-path").includes("main.tex"), "project search finds text and names the file");
    store().set({ cursor: { line: 1, column: 1 } });
    hit.click();
    const sectionLine = text(".cm-content").split("\\section")[0].length; // only to prove the jump below
    await until("the cursor to move to the match", () => store().cursor.line > 1);
    await ok(sectionLine > 0, "clicking a result goes to that line");
    misses = audit();
    await ok(misses.length === 0, `every control in the search panel is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);
    await click("File tree");
    await until("the file tree again", () => $(".file-row"));

    // --- the compiler can be chosen per project, and a missing one is refused, not swapped
    const engines = await invoke("engines_available");
    await click("Settings");
    await until("the compiler choices", () => $("#eng-auto") && $("#eng-tectonic") && $("#eng-latexmk"));
    await ok($("#eng-auto").checked, "Settings offers the compiler choice, on Automatic by default");
    await ok($("#theme-fieldwork").checked && $("#theme-glass") && $("#theme-onyx"), "and the three themes");
    misses = audit();
    await ok(misses.length === 0, `every control in Settings is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);
    await ok($("#eng-latexmk").disabled === !engines.latexmk, "a compiler that is not installed cannot be chosen");
    await click("Cancel");
    const other = engines.tectonic && engines.latexmk ? "latexmk" : null;
    if (other) {
      store().set({ info: await invoke("project_set_engine", { engine: other }) });
      await click("Recompile");
      await until("the other compiler to finish", () => text(".sfoot").includes("latexmk engine") && text(".proj .st") === "Compiled", 180000);
      await ok(true, "choosing latexmk compiles with latexmk");
      store().set({ info: await invoke("project_set_engine", { engine: "auto" }) });
      await click("Recompile");
      await until("the default compiler again", () => text(".sfoot").includes("Tectonic engine") && text(".proj .st") === "Compiled", 180000);
      await ok(true, "and Automatic goes back to Tectonic");
    }

    // --- an edit marks the tab unsaved
    buffers.insert("% typed by the test\n");
    await until("the unsaved marker", () => $(".stab.on .dot"));
    await ok(true, "an edited file shows as unsaved");
    await act.save();
    await ok(!$(".stab.on .dot"), "saving clears the marker");

    // --- an error is reported on its line and the last PDF stays
    const good = (await invoke("file_read", { path: "main.tex" })).text;
    await writeOutside({ path: "main.tex", text: good.replace("Start writing here.", "Start \\undefinedthing here.") });
    await until("the reloaded buffer", () => text(".cm-content").includes("undefinedthing"));
    await ok(true, "a file changed on disk reloads into its clean buffer");
    await click("Recompile");
    await status("Compile failed");
    await ok(/^[1-9]\d* error/.test(text(".proj .dim").trim()), "the top bar counts the error");
    await ok($$(".pdf-page canvas").length > 0, "the previous PDF is still shown");
    await until("the gutter marker", () => $(".cm-lint-marker-error"));
    await ok(true, "the error is marked in the editor gutter");
    await shot("03-error");
    await writeOutside({ path: "main.tex", text: good });
    await until("the fixed buffer", () => !text(".cm-content").includes("undefinedthing"));
    await click("Recompile");
    await status("Compiled");
    await ok(true, "fixing the error compiles cleanly again");

    // --- source to PDF and back
    const line = good.split("\n").findIndex((l) => l.includes("Start writing here.")) + 1;
    buffers.goToLine(line);
    await sleep(200);
    await click("Go to this place in the PDF");
    const mark = await until("the PDF highlight", () => $(".pdf-hl"));
    await ok(true, "jumping to the PDF highlights the matching place");
    await shot("04-jump");
    buffers.goToLine(1);
    const box = mark.getBoundingClientRect();
    $(".pdf-page").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: box.left + box.width / 3, clientY: box.top + box.height / 2 }),
    );
    await until("the cursor to return", () => Math.abs(store().cursor.line - line) <= 1);
    await ok(true, "double-clicking the PDF moves the cursor to that source line");

    // --- hand off: A exports, B opens it as a new project and edits, A edits too
    await invoke("history_snapshot", { label: "Draft 1" });
    const out = `${work}\\out.emquad`;
    const sent = await invoke("bundle_export", { dest: out, note: "Please review", includePdf: true, includePackages: false, includeComments: true });
    await ok(sent.includes.pdf && sent.includes.history, "export writes a bundle with history and the PDF");
    await invoke("settings_update", { displayName: "Lina" });
    const b = await invoke("bundle_import_new", { path: out, parentDir: `${work}\\lina` });
    await ok(b.info.projectId === a.info.projectId, "the bundle opens elsewhere as the same project");
    const theirs = good
      .replace("Start writing here.", "Start writing here, said Lina.")
      .replace("A short summary of the paper.", "A short summary, tightened by Lina.");
    await writeOutside({ path: "main.tex", text: theirs });
    const back = `${work}\\back.emquad`;
    await invoke("bundle_export", { dest: back, note: "Tightened the wording", includePdf: false, includePackages: false, includeComments: true });
    await invoke("settings_update", { displayName: "Tamer" });

    await act.openProject(a.root);
    await until("project A again", () => store().root === a.root && text(".cm-content").includes("\\documentclass"));
    await writeOutside({ path: "main.tex", text: good.replace("Start writing here.", "Start writing here, said Tamer.") });
    await until("our own edit", () => text(".cm-content").includes("said Tamer"));
    const before = (await invoke("file_read", { path: "main.tex" })).text;

    // --- import for review
    await act.importBundle(back);
    await until("the review panel", () => $(".changes .conf"));
    await ok($$(".changes .conf").length === 1, "the review lists the one conflict");
    await ok($$(".changes .mrg").length === 1, "and the one change that merged automatically");
    await ok(button("Finish merge").disabled, "Finish merge waits for the conflict");
    await ok((await invoke("file_read", { path: "main.tex" })).text === before, "importing has not touched the working copy");
    await ok(store().pendingReviews === 1, "one bundle is counted as waiting for review");
    await shot("05-review");

    misses = audit();
    await ok(misses.length === 0, `every control in History and the review is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);

    $(".opt.theirs").click();
    await until("Finish merge to unlock", () => !button("Finish merge").disabled);
    await ok($(".opt.theirs").getAttribute("aria-pressed") === "true", "choosing a side marks it");

    // --- then resolve the same conflict by hand instead
    await click("Edit by hand");
    const hand = await until("the hand-editing box", () => $(".hand textarea"));
    await ok(hand.value.includes("said Tamer") && hand.value.includes("said Lina"), "the box starts with both versions");
    type(hand, "Start writing here, said both of us.");
    await click("Use this text");
    await until("the edit to be recorded", () => text(".opt.custom").includes("said both of us"));
    await ok($(".opt.theirs").getAttribute("aria-pressed") === "false" && !button("Finish merge").disabled, "a hand edit replaces the earlier choice and still unlocks Finish merge");
    await click("Finish merge");
    await until("the review to close", () => !$(".changes"));
    const merged = (await invoke("file_read", { path: "main.tex" })).text;
    await ok(
      merged.includes("said both of us.\n") && merged.includes("tightened by Lina") && !merged.includes("said Tamer") && !merged.includes("said Lina"),
      "the merge wrote the hand-edited passage and the automatic change",
    );
    const list = await invoke("history_list");
    await ok(list.versions[0].kind === "merge" && list.versions[0].parents.length === 2, "History records the merge with both parents");
    await ok(list.versions.every((v) => !v.pending), "no bundle is left waiting");
    await sleep(600);
    await ok(!$(".toast.error"), "finishing the merge raises no error notice");
    await shot("06-history");

    await click("Back to editor");
    await until("the merged text in the editor", () => text(".cm-content").includes("said both of us"));
    await ok(true, "the editor shows the merged file");

    // --- spelling: prose is checked, LaTeX is not, and a correction is one click
    const figure = `${a.root}\\plot.pdf`;
    await invoke("pdf_save", { dest: figure });
    await writeOutside({
      path: "refs.bib",
      text: "@book{knuth84,\n  author = {Knuth, Donald E.},\n  title = {The TeXbook},\n  year = {1984}\n}\n",
    });
    const paper = [
      "\\documentclass{article}",
      "\\usepackage{graphicx}",
      "\\begin{document}",
      "This sentense mentions zorblat once.",
      "",
      "\\begin{tabular}{ll}",
      "\\hline",
      " Name & Value \\\\",
      " $x$ & \\textbf{two} \\\\",
      "\\hline",
      "\\end{tabular}",
      "",
      "\\includegraphics[width=3cm]{plot}",
      "",
      "As shown by \\cite{knuth84} and \\cite{nobody}.",
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n");
    await writeOutside({ path: "main.tex", text: paper });
    await until("the new text", () => text(".cm-content").includes("sentense"));
    const wrong = () => $$(".cm-misspelled").map((w) => w.textContent);
    await until("the misspelled words to be underlined", () => wrong().length === 2, 30000);
    await ok(wrong().join() === "sentense,zorblat", "only the two misspelled words of prose are underlined, no command, key or file name");
    const rightClick = (el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    };
    rightClick($$(".cm-misspelled")[0]);
    // The panel opens at once; the corrections come from the dictionary's worker a moment later.
    const fixes = await until("the corrections", () => $(".cm-spell-fix") && $$(".cm-spell button"));
    await ok(fixes[0].textContent === "sentence" && document.activeElement === fixes[0], "right-clicking offers corrections, the likeliest first and focused");
    await shot("07-spelling");
    fixes[0].click();
    await until("the correction", () => text(".cm-content").includes("This sentence mentions"));
    await ok(wrong().join() === "zorblat", "choosing one corrects the word");
    rightClick($$(".cm-misspelled")[0]);
    (await until("the dictionary button", () => $(".cm-spell-learn"))).click();
    await until("the word to be accepted", () => wrong().length === 0);
    await ok((await invoke("settings_get")).dictionary.includes("zorblat"), "a word added to the dictionary is remembered and no longer underlined");
    await act.save();

    // --- visual mode draws tables, figures and citations in place
    buffers.goToLine(1);
    await click("Visual");
    await until("the table", () => $$(".cm-v-tedit td").length === 4);
    await ok($$(".cm-v-tedit td.rule-top").length === 2 && $(".cm-v-tedit .katex") && $(".cm-v-tedit b")?.textContent === "two", "a table is drawn as a table, with its rules, mathematics and bold text");
    await until("the figure", () => $(".cm-v-figure img")?.naturalWidth > 0, 30000);
    await ok(true, "a figure is drawn as its picture, here the first page of a PDF");
    const cites = () => $$(".cm-v-cite").map((c) => c.textContent);
    await until("the citations", () => cites().length === 2 && cites()[0] === "[Knuth 1984]", 15000);
    await ok(cites()[1] === "[nobody?]" && $$(".cm-v-cite")[1].classList.contains("cm-v-cite-unknown"), "citations are named by author and year, and one nobody defines is marked");
    await shot("08-visual");
    buffers.goToLine(7);
    await until("the table's source", () => $$(".cm-v-tedit").length === 0);
    await ok(true, "putting the cursor in the table shows its source again");
    buffers.goToLine(1);

    // --- the table editor: every action rewrites the LaTeX at once
    {
      const before = buffers.text("main.tex");
      const src = () => buffers.text("main.tex");
      const tabular = () => /\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/.exec(src())[0];
      const td = (r, c) => $(`.cm-v-tedit td[data-r="${r}"][data-c="${c}"]`);
      const press = (el, key, more = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));
      const drag = (from, to) => {
        from.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        if (to !== from) to.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      };
      const tool = (id) => $(`.cm-v-tbar button[data-action="${id}"]`);
      /** The menu of the tool bar that holds an action, opened; or null for an action on the bar itself. */
      const menuOf = (id) => {
        const holder = $$(".cm-v-tbar button[data-items]").find((b) => b.dataset.items.split(" ").includes(id));
        if (holder && !$(".cm-v-tmenu")) holder.click();
        return holder ? $(`.cm-v-tmenu button[data-action="${id}"]`) : null;
      };
      /** Use a tool, from the bar or from the menu that holds it. */
      const use = (id) => (tool(id) ?? menuOf(id)).click();
      /** Whether a tool can be used now. */
      const usable = (id) => {
        if (tool(id)) return !tool(id).disabled;
        const item = menuOf(id);
        const can = !item.disabled;
        press(item, "Escape");
        return can;
      };
      const box = () => $(".cm-v-tedit input.cm-v-tcell");
      await until("the drawn table", () => td(0, 1));

      drag(td(0, 1), td(0, 1));
      await until("a cell to type in", () => box() && document.activeElement === box());
      await ok(box().value === "Value", "clicking a cell opens it for typing, showing its LaTeX");
      type(box(), "Total");
      await ok(tabular().includes("Name & Total \\\\"), "typing in a cell rewrites the source as each letter lands");
      type(box(), "R&D 5%");
      await ok(box().value === "R\\&D 5\\%" && tabular().includes("Name & R\\&D 5\\% \\\\"), "an ampersand or percent sign typed in a cell is written the way LaTeX prints it");
      type(box(), "\\textbf{open");
      await ok(box().classList.contains("bad") && tabular().includes("R\\&D 5\\%"), "text that would break the table is held back and marked until it is whole");
      type(box(), "\\textbf{Total}");
      await ok(!box().classList.contains("bad") && tabular().includes("\\textbf{Total}"), "and goes in once its braces match");

      press(box(), "Tab");
      await ok(box()?.value === "$x$" && box().closest("td") === td(1, 0), "Tab moves to the next cell");
      press(box(), "Tab", { shiftKey: true });
      await ok(box().closest("td") === td(0, 1), "Shift+Tab moves back");
      box().setSelectionRange(0, 0);
      press(box(), "ArrowLeft");
      await ok(box().closest("td") === td(0, 0), "an arrow key at the edge of the text moves to the neighbouring cell");
      press(box(), "ArrowDown");
      await ok(box().closest("td") === td(1, 0), "and the down arrow to the cell below");
      drag(td(1, 1), td(1, 1));
      press(box(), "Tab");
      await until("a new row", () => td(2, 0) && box()?.closest("td") === td(2, 0));
      await ok((tabular().match(/\\\\/g) ?? []).length === 3, "Tab in the last cell adds a row and moves into it");
      type(box(), "y");
      press(box(), "Tab");
      type(box(), "three");

      // Merge across a row.
      drag(td(0, 0), td(0, 1));
      await ok($$(".cm-v-tedit td.sel").length === 2 && usable("merge"), "dragging across cells selects them and enables Merge");
      tool("merge").click();
      await ok(tabular().includes("\\multicolumn{2}{l}{Name \\textbf{Total}} \\\\") && !src().includes("multirow"), "merging across a row writes \\multicolumn and keeps the text of both cells");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      await ok(tabular().includes("Name & \\textbf{Total} \\\\") && !tabular().includes("multicolumn"), "Ctrl+Z takes back the whole merge in one step");
      press($(".cm-v-tedit"), "y", { ctrlKey: true });
      await ok(tabular().includes("\\multicolumn{2}{l}{Name \\textbf{Total}}"), "and Ctrl+Y puts it back");

      // Merge down a column, with the keyboard.
      drag(td(1, 0), td(1, 0));
      press(box(), "ArrowDown", { shiftKey: true });
      await ok($$(".cm-v-tedit td.sel").length === 2, "Shift and an arrow key extends the selection by a cell");
      tool("merge").click();
      await until("the package line", () => src().includes("\\usepackage{multirow}"));
      await ok(tabular().includes("\\multirow{2}{*}{$x$ y} & \\textbf{two} \\\\\n& three \\\\"), "merging down a column writes \\multirow, with an empty cell under it");
      await ok(/multirow/.test(text(".toast")) && src().indexOf("\\usepackage{multirow}") < src().indexOf("\\begin{document}"), "the multirow package is added to the preamble, and the app says so");

      use("bordersNone");
      await ok(!/hline|cline/.test(tabular()) && tabular().startsWith("\\begin{tabular}{ll}"), "No borders removes every rule");
      use("bordersAll");
      await ok(tabular().startsWith("\\begin{tabular}{|l|l|}") && tabular().includes("\\cline{2-2}\n") && !/\\\\\n\\hline\n& three/.test(tabular()), "and All borders draws them all, with \\cline so no rule cuts the merged cell");
      await shot("10-table");

      await act.compile();
      await ok(store().build?.ok, "the document compiles with the merged cells as written");

      // Split.
      drag(td(1, 0), td(1, 0));
      press(box(), "Escape");
      await ok(usable("split") && !usable("splitRows"), "a merged cell offers Unmerge, an ordinary one the two divisions");
      use("split");
      await ok(!tabular().includes("multirow") && tabular().includes("$x$ y & \\textbf{two} \\\\\n\\hline\n& three \\\\"), "splitting a merged cell gives back its cells, the text staying in the first, and the rule returns");
      drag(td(2, 1), td(2, 1));
      press(box(), "Escape");
      use("splitColumns");
      await ok(tabular().startsWith("\\begin{tabular}{|l|l|l|}") && tabular().includes("\\multicolumn{2}{l|}{\\textbf{two}}") && tabular().includes("& three & \\\\"), "splitting an ordinary cell adds a column and widens the cells above it");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });

      // Rows, columns, alignment.
      drag(td(2, 1), td(2, 1));
      press(box(), "Escape");
      use("rowBelow");
      use("columnRight");
      await ok((tabular().match(/\\\\/g) ?? []).length === 4 && tabular().startsWith("\\begin{tabular}{|l|l|l|}"), "a row and a column can be added");
      use("deleteColumn");
      use("deleteRow");
      use("alignCentre");
      await ok((tabular().match(/\\\\/g) ?? []).length === 3 && tabular().startsWith("\\begin{tabular}{|l|c|}"), "and deleted, and a column centred");
      await ok(tool("alignCentre").getAttribute("aria-pressed") === "true" && tool("alignLeft").getAttribute("aria-pressed") === "false", "the alignment tools show the alignment of the column");

      // Choosing cells with the mouse, as in a word processor.
      const handles = (kind) => $$(`.cm-v-tedit th.cm-v-${kind}`);
      const chosen = () => $$(".cm-v-tedit td.sel").map((cell) => `${cell.dataset.r},${cell.dataset.c}`);
      drag(handles("rowh")[1], handles("rowh")[2]);
      await ok($$(".cm-v-tedit td").every((cell) => cell.classList.contains("sel") === (cell.dataset.r !== "0")), "dragging along the row handles selects whole rows");
      drag(handles("corner")[0], handles("corner")[0]);
      await ok($$(".cm-v-tedit td").every((cell) => cell.classList.contains("sel")), "the corner handle selects the whole table");
      drag(td(1, 0), td(1, 0));
      box().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      td(1, 1).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await ok(!box() && chosen().join(" ") === "1,0 1,1", "a drag that starts in the text of a cell and goes on into the next selects cells");
      const beforeBold = tabular();
      use("bold");
      await ok(/\\textbf\{[^&]+\} & \\textbf\{/.test(tabular()) && chosen().length === 2, "Bold sets every selected cell in bold, keeping the selection");
      use("bold");
      await ok(!tabular().includes("\\textbf{$x$"), "and Bold again, with every cell bold, takes them all out of bold");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      await ok(tabular() === beforeBold, "each one a step of its own for Ctrl+Z");

      // The clipboard: cells out as LaTeX and as a table, and back in from the selected cell.
      drag(td(1, 0), td(1, 1));
      const clip = new DataTransfer();
      $(".cm-v-tedit").dispatchEvent(new ClipboardEvent("copy", { clipboardData: clip, bubbles: true, cancelable: true }));
      await ok(clip.getData("text/plain").includes("\t") && /<table>/.test(clip.getData("text/html")), "copying selected cells puts them on the clipboard as text and as a table");
      drag(td(2, 0), td(2, 0));
      press(box(), "Escape");
      const pasted = new DataTransfer();
      pasted.setData("text/plain", "p_1\t50%\nq\tr");
      $(".cm-v-tedit").dispatchEvent(new ClipboardEvent("paste", { clipboardData: pasted, bubbles: true, cancelable: true }));
      await ok(tabular().includes("p\\_1 & 50\\% \\\\\n") && tabular().includes("q & r \\\\"), "cells copied from a spreadsheet paste into the cells from the selected one on, rows added as needed and escaped");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      await ok(!tabular().includes("p\\_1"), "and Ctrl+Z takes the paste back in one step");

      // Rules in the style of the booktabs package.
      use("bordersBook");
      await until("the booktabs package", () => src().includes("\\usepackage{booktabs}"));
      await ok(/\\toprule[\s\S]*\\midrule[\s\S]*\\bottomrule/.test(tabular()) && !tabular().includes("|"), "Book style draws booktabs rules, no vertical lines, and adds the package");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      await ok(!src().includes("booktabs") && tabular().startsWith("\\begin{tabular}{|l|c|}"), "and Ctrl+Z takes back the rules and the package together");

      // Into the table without a mouse: it is in the tab order, and Enter goes into its cells.
      document.activeElement.blur();
      await ok($(".cm-v-tedit").tabIndex === 0, "the table can be reached with Tab");
      $(".cm-v-tedit").focus();
      drag(td(0, 0), td(0, 0));
      press(box(), "Escape");
      press($(".cm-v-tedit"), "ArrowDown");
      await ok(td(1, 0).classList.contains("cur") && !box(), "with the table focused, the arrow keys move between cells");
      press($(".cm-v-tedit"), "Enter");
      await ok(box()?.closest("td") === td(1, 0), "and Enter starts typing in the cell");
      press(box(), "Escape");

      // The menu, from the keyboard.
      press($(".cm-v-tedit"), "F10", { shiftKey: true });
      const items = await until("the table menu", () => ($(".cm-v-tmenu") ? $$(".cm-v-tmenu button") : null));
      await ok(document.activeElement === items[0] && items.length > 6, "Shift+F10 opens the table's menu with the keyboard on its first item");
      misses = audit();
      await ok(misses.length === 0, `every control of the table editor is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);
      press(items[0], "Escape");
      await ok(!$(".cm-v-tmenu") && document.activeElement === $(".cm-v-tedit"), "Escape closes it and returns to the table");

      // Caption.
      tool("caption").click();
      type(await until("the caption prompt", () => $("#ask-value")), "Results by year");
      await click("Save");
      await until("the caption", () => src().includes("\\caption{Results by year}"));
      await ok(/\\begin\{table\}\[h\]\n\\centering\n\\begin\{tabular\}/.test(src()) && src().includes("\\end{tabular}\n\\caption{Results by year}\n\\end{table}"), "a caption puts the table in a float that carries it");
      await ok($(".cm-v-tedit td"), "and the table is still drawn and editable");

      // Symbols: written as the place they go needs, into the cell being typed in or the text.
      drag(td(1, 0), td(1, 0));
      const original = box().value;
      type(box(), `${original} $`);
      store().set({ symbols: true });
      const search = await until("the symbol panel", () => $(".sym-search"));
      await ok(document.activeElement === search && $$(".sym-grid button").length > 10, "the Symbol panel opens with the keyboard in its search box");
      type(search, "alpha");
      press(search, "Enter");
      await until("alpha in the cell", () => box()?.value === `${original} $\\alpha `).catch((e) => {
        throw new Error(`${e.message}: cell ${JSON.stringify(box()?.value)}, focus ${document.activeElement?.className}, panel ${!!$(".sym-pop")}, first ${$(".sym-grid button")?.getAttribute("aria-label")}`);
      });
      await ok(box().classList.contains("bad") && document.activeElement === box(), "a symbol chosen while a formula is half typed in a cell goes into it, as part of the formula, and nothing typed is lost");
      type(box(), `${original} $\\alpha$`);
      await ok(tabular().includes(`${original} $\\alpha$`), "and the cell is written once the formula is closed");
      type(box(), original);
      store().set({ symbols: true });
      type(await until("the symbol panel", () => $(".sym-search")), "fraction");
      press($(".sym-search"), "Enter");
      await until("the fraction in the cell", () => tabular().includes("$\\frac{}{}$"));
      await ok(box()?.closest("td") === td(1, 0) && !$(".sym-pop"), "a structure chosen while typing in a cell goes into that cell, as a formula");
      await until("the symbol remembered", async () => (await invoke("settings_get")).recentSymbols[0] === "\\frac{…}{}");
      press($(".cm-v-tedit"), "z", { ctrlKey: true });
      const prose = src().split("\n").findIndex((line) => line.startsWith("This sentence")) + 1;
      buffers.goToLine(prose);
      store().set({ symbols: true });
      type(await until("the symbol panel", () => $(".sym-search")), "\\leqslant");
      press($(".sym-search"), "Enter");
      await until("the symbol in the text", () => src().includes("$\\leqslant$This sentence"));
      await ok(src().indexOf("\\usepackage{amssymb}") > 0 && src().indexOf("\\usepackage{amssymb}") < src().indexOf("\\begin{document}") && /amssymb/.test(text(".toast")), "a formula symbol chosen in text goes in as $…$, and the package it needs is added, and the app says so");
      await undoText();
      await ok(!src().includes("amssymb") && !src().includes("leqslant"), "and one undo takes both back");

      // Deleting the table takes the float that held only it and its caption.
      drag(td(0, 0), td(0, 0));
      press(box(), "Escape");
      use("deleteTable");
      await ok(!src().includes("\\begin{table}") && !src().includes("\\begin{tabular}") && !$(".cm-v-tedit"), "Delete table removes the table and the float that held it");
      await undoText();
      await until("the table back", () => src().includes("\\caption{Results by year}") && $(".cm-v-tedit td"));
      await ok(true, "and undo brings it back");

      // A table that cannot be written back exactly is shown, not edited.
      buffers.goToLine(5);
      buffers.insert("\\begin{tabular}{lS}\n a & b \\\\\n\\end{tabular}\n\n");
      buffers.goToLine(1);
      const note = await until("the read-only table", () => $(".cm-v-table .cm-v-tnote"));
      await ok(/column type/.test(note.textContent) && $$(".cm-v-tedit").length === 1, "a table with a column type the editor does not know is drawn read-only, with the reason");
      const handWritten = src();
      note.querySelector("button").click();
      await until("its source", () => !$(".cm-v-table"));
      await ok(src() === handWritten, "Edit source shows its LaTeX, untouched");
      buffers.goToLine(1);

      // Paste from Word or Excel.
      const copied = new DataTransfer();
      copied.setData("text/html", "<table><tr><th colspan=2>R&amp;D costs</th></tr><tr><td>2025</td><td>50%</td></tr></table>");
      copied.setData("text/plain", "R&D costs\t\n2025\t50%");
      buffers.goToLine(5);
      $(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: copied, bubbles: true, cancelable: true }));
      await until("the paste question", () => text("dialog[open]").includes("2 rows and 2 columns"));
      await click("Paste as table");
      await until("the pasted table", () => src().includes("\\multicolumn{2}{|l|}{R\\&D costs} \\\\"));
      await ok(src().includes("2025 & 50\\% \\\\"), "a table copied from Word or Excel is offered as a table, merged cells and special characters included");
      const indented = new DataTransfer();
      indented.setData("text/plain", "\\begin{itemize}\n\t\\item a\n\\end{itemize}\n");
      $(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: indented, bubbles: true, cancelable: true }));
      await sleep(300);
      await ok(!$("dialog[open]"), "ordinary text with tabs in it is not taken for a table");
      $(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: copied, bubbles: true, cancelable: true }));
      await until("the paste question again", () => text("dialog[open]").includes("2 rows and 2 columns"));
      await click("Cancel");
      // Declined, it goes in as text, written so that it prints.
      await until("the plain text", () => src().includes("2025\t50\\%"));
      await ok(true, "declining pastes the plain text instead");
      const ours = new DataTransfer();
      ours.setData("application/x-emquad-cells", JSON.stringify([["\\textbf{a}", "$x^2$"]]));
      ours.setData("text/html", "<table><tr><td>\\textbf{a}</td><td>$x^2$</td></tr></table>");
      ours.setData("text/plain", "\\textbf{a}\t$x^2$");
      buffers.goToLine(5);
      $(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: ours, bubbles: true, cancelable: true }));
      await until("the paste question for our cells", () => text("dialog[open]").includes("1 row and 2 columns"));
      await click("Paste as table");
      await until("our cells", () => src().includes("\\textbf{a} & $x^2$ \\\\"));
      await ok(!src().includes("textbackslash"), "cells copied from a table here paste into the text as the LaTeX they held");

      // The size picker.
      buffers.goToLine(5);
      await click("Insert table");
      const picker = await until("the size picker", () => $(".tpick-grid"));
      await ok(document.activeElement === picker, "the table button opens a size picker that takes the keyboard");
      press(picker, "ArrowRight");
      press(picker, "ArrowDown");
      await until("the chosen size", () => text(".tpick-size").includes("3 × 3"));
      press(picker, "Enter");
      await until("the new table", () => src().includes("\\begin{tabular}{|l|l|l|}\n\\hline\n&  & \\\\"));
      await ok(!$(".tpick-pop"), "choosing a size writes an empty table of that size");

      // Leave the document as the checks after this one expect it.
      await click("Code");
      await until("plain source", () => !$(".cm-visual"));
      buffers.replace("main.tex", before);
      await writeOutside({ path: "main.tex", text: before });
      await act.save();
      await click("Visual");
      await until("visual mode again", () => $(".cm-visual"));
    }
    await click("Code");
    await until("plain source", () => !$(".cm-visual"));

    // --- comments: on a passage, kept out of the file, following the text
    const onDisk = (await invoke("file_read", { path: "main.tex" })).text;
    const select = (word) => {
      const from = buffers.text("main.tex").indexOf(word);
      buffers.run((v) => (v.dispatch({ selection: { anchor: from, head: from + word.length } }), true));
    };
    select("mentions zorblat");
    await click("Comment on the selection");
    const draft = await until("the comment box", () => (!$("#comment-draft")?.disabled ? $("#comment-draft") : null));
    type(draft, "Is zorblat a real word?");
    await click("Add comment");
    await until("the comment", () => text(".comment").includes("Is zorblat a real word?"));
    await ok($(".cm-comment")?.textContent === "mentions zorblat", "a comment is put on the selected passage, which is tinted");
    await ok((await invoke("file_read", { path: "main.tex" })).text === onDisk, "and nothing is written into the file");
    buffers.goToLine(4);
    buffers.insert("A new first paragraph.\n\n");
    await act.save();
    const moved = (await invoke("comments_list"))[0];
    await ok(moved.line === 6 && moved.quote === "mentions zorblat", "the comment follows its passage when text is added above it");
    await click("Reply");
    type(await until("the reply box", () => $(".comment-reply textarea")), "It is now.");
    $(".comment-reply").requestSubmit();
    await until("the reply", () => $$(".comment-entry").length === 2);
    await ok(text(".rail .badge") === "1" || $$(".rail .badge").some((b) => b.textContent === "1"), "the reply is listed and the rail counts the open comment");
    misses = audit();
    await ok(misses.length === 0, `every control in the comments panel is focusable and named${misses.length ? `: ${misses.join("; ")}` : ""}`);
    await shot("09-comments");

    // --- a bundle can carry the comments and the LaTeX packages
    await act.compile();
    await ok(store().build?.ok, "the document with a table, a figure and a bibliography compiles");
    store().set({ dialog: "export" });
    await until("the packages choice", () => $("#inc-packages") && !$("#inc-packages").disabled, 20000);
    await ok(/MB/.test($("#inc-packages").closest("label").textContent) && !$("#inc-comments").disabled, "the export dialog offers the packages, with their size, and the comments");
    await click("Cancel");
    const full = `${work}\\full.emquad`;
    const carried = await invoke("bundle_export", { dest: full, note: "", includePdf: false, includePackages: true, includeComments: true });
    await ok(carried.includes.packages && carried.includes.comments, "the bundle is exported once it is shown to compile with no internet");
    await click("Resolve");
    await until("the comment to leave the list", () => !$(".comment"));
    await ok(!$(".cm-comment") && text(".comment-toggle").includes("(1)"), "a resolved comment is put away, and can be shown again");

    await invoke("settings_update", { displayName: "Lina" });
    const c = await invoke("bundle_import_new", { path: full, parentDir: `${work}\\offline` });
    await act.openProject(c.root);
    // Opened for the first time, so in visual mode, its settings folded away.
    await until("the bundle's project", () => store().root === c.root && ($(".cm-v-fold") || text(".cm-content").includes("\\documentclass")));
    await until("its comments", () => store().comments.length === 1);
    await ok(store().comments[0].replies.length === 1 && !store().comments[0].resolved, "the recipient gets the comment and its reply, as they were when the bundle was made");
    await click("Recompile");
    await until("a PDF from the bundle's own packages", () => text(".proj .st") === "Compiled", 300000);
    await ok(true, "and compiles the project from the packages that came with it");
    await invoke("settings_update", { displayName: "Tamer" });

    // A thesis, and what a Word user reaches for first.
    {
      const t = await invoke("project_create", { parentDir: work, name: "my thesis", template: "thesis" });
      await act.openProject(t.root);
      await until("the thesis to compile", () => store().root === t.root && store().build && !store().compiling, 300000);
      await ok(store().build.hasPdf && !store().build.diagnostics.some((d) => d.severity === "error"), "the Thesis template compiles at once, its reference and contents with it");
      await until("the drawn contents", () => $$(".cm-v-block").some((b) => b.textContent === "Table of contents"));
      await until("the reference by name", () => $$(".cm-v-cite").some((c) => c.textContent.includes("Knuth")));
      await ok(true, "visual mode draws the contents as a block and the citation by its author");
      await until("the word count", () => /\d+ words/.test(text(".sfoot")));
      await ok(true, "the status line counts the words of the file");
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const line = buffers.text("main.tex").split("\n").findIndex((l) => l.startsWith("Start writing here")) + 1;
      buffers.goToLine(line);
      const editor = $(".cm-content");
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
      await ok(buffers.text("main.tex").includes("\\textbf{}Start writing here") && store().filesOpen, "Ctrl+B starts bold text, as in a word processor, and leaves the file panel alone");
      const fromWord = new DataTransfer();
      fromWord.setData("text/plain", "Costs rose 50% for R&D.\r\nA second paragraph.");
      fromWord.setData("text/html", "<p>Costs rose 50% for R&amp;D.</p><p>A second paragraph.</p>");
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: fromWord, bubbles: true, cancelable: true }));
      // Pasted inside the bold just begun, where a paragraph cannot end: the two are joined.
      await ok(buffers.text("main.tex").includes("\\textbf{Costs rose 50\\% for R\\&D. A second paragraph.}"), "text pasted from Word prints as it reads, and inside bold its paragraphs are joined so it compiles");
      buffers.goToLine(line + 2);
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: fromWord, bubbles: true, cancelable: true }));
      await ok(buffers.text("main.tex").includes("Costs rose 50\\% for R\\&D.\n\nA second paragraph."), "in ordinary text each pasted paragraph is kept");
      await act.save();
    }

    // Compile errors in plain words, each put right with a click; the page set up as in Word.
    {
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const broken = buffers.text("main.tex").replace("Start writing here.", "Start writing here, see \\url{https://example.org} on Q&A.");
      await writeOutside({ path: "main.tex", text: broken });
      await until("the changed text", () => buffers.text("main.tex").includes("Q&A"));
      await act.compile();
      const helps = () => store().build.diagnostics.filter((d) => d.severity === "error").map((d) => act.helpFor(d));
      const packageFix = helps().find((h) => h?.fix?.kind === "package")?.fix;
      await ok(packageFix?.name === "url", "an unknown command is explained in plain words, naming the package it comes from");
      await act.applyFix(packageFix);
      await until("the compile after the fix", () => !store().compiling && store().build);
      await ok(buffers.text("main.tex").includes("\\usepackage{url}"), "the fix adds the package to the settings, and compiles again");
      const escapeFix = helps().find((h) => h?.fix?.kind === "escape")?.fix;
      await ok(escapeFix?.char === "&", "a stray & in text is explained, with a fix");
      await act.applyFix(escapeFix);
      await until("the compile after the second fix", () => !store().compiling && store().build);
      await ok(buffers.text("main.tex").includes("Q\\&A") && !store().build.diagnostics.some((d) => d.severity === "error"), "the fix writes it as \\& and the document compiles");
      store().set({ dialog: "setup" });
      const margins = await until("the Document setup dialog", () => $("#su-margins"));
      const pick = (select, value) => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      pick(margins, "1.5cm");
      pick($("#su-spacing"), "double");
      await shot("10-setup");
      (await until("Apply", () => button("Apply"))).click();
      await until("the setup applied and compiled", () => !$("#su-margins") && !store().compiling && buffers.text("main.tex").includes("margin=1.5cm"));
      // The template's comment names \onehalfspacing too; the setting is the line on its own.
      const set = buffers.text("main.tex");
      await ok(/^\\doublespacing$/m.test(set) && !/^\\onehalfspacing$/m.test(set) && !store().build.diagnostics.some((d) => d.severity === "error"), "Document setup sets the margins and line spacing, and the document compiles");
      await act.save();
    }

    // References as Word's Add New Source and Insert Citation have them, and a style by name.
    {
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const line = buffers.text("main.tex").split("\n").findIndex((l) => l.includes("Start writing here")) + 1;
      buffers.goToLine(line);
      store().set({ dialog: "reference" });
      type(await until("the Add a reference form", () => $("#ref-authors")), "Ada Lovelace\nCharles Babbage");
      type($("#ref-title"), "Sketch of the Analytical Engine");
      type($("#ref-year"), "1843");
      type($("#ref-where"), "Scientific Memoirs");
      await shot("11-reference");
      await click("Add and cite");
      await until("the reference cited", () => !$("#ref-authors") && buffers.text("main.tex").includes("\\cite{lovelace1843}"));
      await ok(line > 0 && buffers.text("main.tex").split("\n")[line - 1].includes("\\cite{lovelace1843}"), "the citation goes where the cursor is");
      const bib = (await invoke("file_read", { path: "references.bib" })).text;
      await ok(
        bib.includes("@article{lovelace1843,") && bib.includes("{Lovelace, Ada and Babbage, Charles}") && bib.includes("@book{knuth1984,"),
        "a reference written in a form goes into the project's .bib file, after those it had, and is cited where the cursor is",
      );
      await until("the new reference in the index", () => store().index.citations.some((c) => c.key === "lovelace1843"));
      store().set({ dialog: "cite" });
      type(await until("the Cite dialog", () => $("#cite-search")), "babbage");
      await until("one reference found", () => $$(".refs .ck").length === 1);
      await shot("12-cite");
      await click("Cite");
      await until("the second citation", () => buffers.text("main.tex").split("\\cite{lovelace1843}").length === 3);
      await ok(true, "the Cite dialog finds a reference by any of its authors, and cites it");
      store().set({ dialog: "citationStyle" });
      (await until("the Citation style dialog", () => $("#cs-apa"))).click();
      await click("Apply");
      await until("the style applied and compiled", () => !$("#cs-apa") && !store().compiling && buffers.text("main.tex").includes("{apalike}"));
      const styled = buffers.text("main.tex");
      await ok(
        styled.includes("\\usepackage{natbib}") && !store().build.diagnostics.some((d) => d.severity === "error" || /Citation .* undefined/.test(d.message)),
        "choosing APA loads what it needs, and the document compiles with every citation found",
      );
      store().set({ dialog: "cite" });
      type(await until("the Cite dialog again", () => $("#cite-search")), "knuth");
      await until("Knuth found", () => $$(".refs .ck").length === 1);
      await click("Cite");
      await until("the citation in parentheses", () => buffers.text("main.tex").includes("\\citep{knuth1984}"));
      await ok(true, "with an author-and-year style, a citation is written to print in parentheses");
      // Zotero must not be running for this check: if it is, its picker opens and waits.
      const zotero = await Promise.race([
        invoke("zotero_pick").then(
          () => null,
          (e) => e,
        ),
        sleep(10000).then(() => ({ code: "running", message: "Zotero answered: close Zotero before running these checks" })),
      ]);
      await ok(zotero?.code === "zotero_missing" && /Better BibTeX/.test(zotero.message), `a citation from Zotero, with Zotero not running, says how to start it (${zotero?.message})`);
      await act.save();
    }

    // Pictures dropped or pasted, text pasted with its formatting, and the equation editor.
    {
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const editor = $(".cm-content");
      const lineOf = (needle) => buffers.text("main.tex").split("\n").findIndex((l) => l.includes(needle)) + 1;
      // A 1 by 1 PNG, as a screenshot would come.
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      buffers.goToLine(lineOf("\\chapter{Method}"));
      const shot1 = new DataTransfer();
      shot1.items.add(new File([png], "image.png", { type: "image/png" }));
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: shot1, bubbles: true, cancelable: true }));
      await until("the pasted picture as a figure", () => buffers.text("main.tex").includes("{figures/pasted.png}"));
      const figure = buffers.text("main.tex");
      await ok(
        figure.includes("\\includegraphics[width=0.8\\linewidth]{figures/pasted.png}\n  \\caption{}\n  \\label{fig:pasted}") && /\\usepackage(\[[^\]]*\])?\{graphicx\}/.test(figure),
        "a picture pasted on its own is added to the project and put in a figure, with graphicx loaded",
      );
      // The same picture dropped on the text, from elsewhere on disk: a figure of its own, the file not copied twice.
      const elsewhere = await window.__TAURI_INTERNALS__.invoke("picture_add", png, { headers: { "x-dir": "dropped", "x-name": "dot.png" } });
      // Dropped on the line of the chapter heading, as seen on screen.
      let point = null;
      buffers.run((v) => ((point = v.coordsAtPos(buffers.text("main.tex").indexOf("\\chapter{Method}"))), true));
      await act.dropFiles([`${store().root}\\${elsewhere.replace("/", "\\")}`], point.left + 4, (point.top + point.bottom) / 2);
      await until("the dropped picture", () => buffers.text("main.tex").includes("{figures/dot.png}"));
      const files = JSON.stringify(await invoke("project_tree"));
      await ok(files.includes("figures/dot.png") && files.includes("figures/pasted.png") && !files.includes("pasted-2"), "a picture dropped on the text becomes a figure where it was dropped");
      await act.save();
      await act.compile();
      await ok(store().build.hasPdf && !store().build.diagnostics.some((d) => d.severity === "error"), "the document with its new figures compiles");

      // Text with formatting from Word: bold, a heading and a list, written as LaTeX.
      buffers.goToLine(lineOf("\\chapter{Method}"));
      const word = new DataTransfer();
      word.setData("text/plain", "Results\nThe yield rose.\nFirst\nSecond");
      word.setData(
        "text/html",
        "<h2>Results</h2><p>The <b>yield</b> rose.</p><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.</span>First</p><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>2.</span>Second</p>",
      );
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: word, bubbles: true, cancelable: true }));
      await ok(
        buffers.text("main.tex").includes("\\subsection{Results}\n\nThe \\textbf{yield} rose.\n\n\\begin{enumerate}\n  \\item First\n  \\item Second\n\\end{enumerate}"),
        "text pasted from Word keeps its bold, headings and numbered list, as LaTeX",
      );

      // The equation editor, as Word's: typed and shown as it prints, built with the ribbon.
      buffers.goToLine(lineOf("\\end{enumerate}"));
      store().set({ dialog: "equation" });
      const mf = await until("the equation editor", () => $("math-field.eq-field"));
      await until("the keyboard in the formula", () => document.activeElement === mf);
      /** Type in the formula a key at a time, as the keyboard does. */
      const typeIn = (field, keys) => {
        for (const key of keys) field.executeCommand(["typedText", key, { simulateKeystroke: true }]);
      };
      // A symbol from the row of symbols, then typing: ^ makes a power and / a fraction.
      $('.eq-sym[aria-label="alpha"]').click();
      typeIn(mf, "+E=mc^2");
      mf.executeCommand("moveToMathfieldEnd");
      typeIn(mf, "+1/2");
      mf.executeCommand("moveToMathfieldEnd");
      typeIn(mf, "+");
      // And from the ribbon: Radical, then Square root, with x typed in its box.
      (await until("the Radical button", () => $$(".eq-tool").find((b) => b.textContent.includes("Radical")))).click();
      (await until("the Square root item", () => $('.eq-pop [aria-label="Square root"]'))).click();
      typeIn(mf, "x");
      const typed = mf.getValue("latex");
      await ok(
        /^\\alpha\+E=mc\^2\+\\frac\{?1\}?\{?2\}?\+\\sqrt\{x\}$/.test(typed),
        `in the equation editor a symbol comes from its row, ^ makes a power, / a fraction, and the ribbon a root (${typed})`,
      );
      $("#eq-numbered").click();
      await shot("13-equation");
      // The dialog's own button: the menu bar has an Insert too.
      $("dialog .end .btn.go").click();
      await until("the numbered equation", () => /\\begin\{equation\}\n  \\alpha\+E=mc\^2\+\\frac\{?1\}?\{?2\}?\+\\sqrt\{x\}\n\\end\{equation\}/.test(buffers.text("main.tex")));
      await ok(true, "Insert puts the formula in the document as a numbered equation, in plain LaTeX");

      // A formula over several lines, lined up at =, as Shift+Enter makes one in Word.
      buffers.goToLine(lineOf("\\end{equation}") + 1);
      store().set({ dialog: "equation" });
      const lines = await until("the equation editor again", () => $("math-field.eq-field"));
      typeIn(lines, "y=(a+b)^2");
      (await until("the New line button", () => $$(".eq-tool").find((b) => b.textContent.includes("New line")))).click();
      typeIn(lines, "=a^2+2ab+b^2");
      await until("display chosen for lines", () => $("#eq-display").checked);
      $("dialog .end .btn.go").click();
      await until("the lines", () => buffers.text("main.tex").includes("\\begin{aligned}"));
      const aligned = buffers.text("main.tex");
      await ok(
        /\\\[\n  \\begin\{aligned\}\s*y\s*&\s*=[^\n]*\\\\\s*&\s*=\s*a\^2\+2ab\+b\^2\s*\\end\{aligned\}\n\\\]/.test(aligned),
        `a new line in the equation editor sets the lines one under another, lined up at = (${aligned.slice(aligned.indexOf("\\begin{aligned}"), aligned.indexOf("\\end{aligned}") + 13)})`,
      );

      const text = buffers.text("main.tex");
      buffers.change("main.tex", { from: text.indexOf("\\end{aligned}\n\\]") + "\\end{aligned}\n\\]".length, insert: "\nwhere $c$ is the speed of light." });
      // The cursor in the formula $c$: the editor opens on it.
      const c = buffers.text("main.tex").indexOf("$c$") + 1;
      buffers.run((v) => (v.dispatch({ selection: { anchor: c } }), true));
      store().set({ dialog: "equation" });
      const again = await until("the equation editor on the formula", () => $("math-field.eq-field"));
      await until("its formula", () => again.getValue("latex") === "c");
      await ok($("#eq-inline").checked, "the equation editor opens on the formula the cursor is in");
      again.executeCommand("moveToMathfieldEnd");
      typeIn(again, "_0");
      await click("Change");
      await until("the formula changed", () => buffers.text("main.tex").includes("where $c_0$ is"));
      // A formula nothing is changed in goes back exactly as it was written, and LaTeX typed under
      // the formula goes in as typed: the editor never rewrites what it was not asked to.
      buffers.change("main.tex", { from: buffers.text("main.tex").indexOf("where $c_0$ is"), insert: "With $\\boldsymbol{v}\\hspace{1em}w$ kept.\n\n" });
      buffers.run((v) => (v.dispatch({ selection: { anchor: buffers.text("main.tex").indexOf("\\boldsymbol{v}") + 2 } }), true));
      store().set({ dialog: "equation" });
      await until("the editor on the bold v", () => $("math-field.eq-field"));
      await click("Change");
      await until("the editor closed", () => !$("math-field.eq-field"));
      const kept = buffers.text("main.tex").includes("With $\\boldsymbol{v}\\hspace{1em}w$ kept.\n\n");
      buffers.run((v) => (v.dispatch({ selection: { anchor: buffers.text("main.tex").indexOf("\\boldsymbol{v}") + 2 } }), true));
      store().set({ dialog: "equation" });
      await until("the editor on it again", () => $("math-field.eq-field"));
      // The editor would write \boldsymbol its own way: it says so, with the LaTeX open.
      await ok(!!(await until("the note", () => $(".eq-note"))) && $(".eq-source").open, "a formula the visual editor would write differently opens with its LaTeX shown, and a note on why");
      if (!$(".eq-source").open) $(".eq-source summary").click();
      type(await until("the LaTeX under the formula", () => $("#eq-tex")), "\\boldsymbol{u}\\hspace{2em}w");
      await click("Change");
      await until("the typed LaTeX", () => buffers.text("main.tex").includes("With $\\boldsymbol{u}\\hspace{2em}w$ kept.\n\n"));
      await ok(kept, "a formula the equation editor changed nothing in goes back exactly as written, and LaTeX typed under it goes in as typed");
      await act.save();
      // In visual mode a double-click on a formula opens the editor on it, as in Word.
      store().set({ visual: true });
      buffers.setVisual(true);
      buffers.goToLine(1);
      const drawn = await until("the formula drawn", () => $$(".cm-v-math").find((m) => m.textContent.includes("0") && !m.closest(".cm-v-display")));
      // The second press of a double-click, where the formula is.
      const box = drawn.getBoundingClientRect();
      drawn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 2, button: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
      const onIt = await until("the editor from a double-click", () => $("math-field.eq-field"));
      await until("the formula in it", () => onIt.getValue("latex").startsWith("c_"));
      await ok(true, "a double-click on a formula in visual mode opens the equation editor on it");
      $("dialog .end .btn:not(.go)").click();
      await until("the editor closed", () => !$("math-field.eq-field"));
      await act.compile();
      await ok(!store().build.diagnostics.some((d) => d.severity === "error"), "the changed formula is put back in its place, and the document compiles");
    }

    // Working with people who use Word: a PDF with the comments on it, one with the changes
    // since a version marked, and Word files through Pandoc when it is installed.
    {
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const { openPdf } = await import("/src/shared/pdf.ts");
      /** The notes on each page of a PDF saved in the project, as a PDF viewer reads them. */
      const notesIn = async (path) => {
        const task = await openPdf(new Uint8Array(await invoke("project_image", { path })));
        const pdf = await task.promise;
        const all = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const words = (await page.getTextContent()).items.map((t) => ({ str: t.str, x: t.transform[4], y: t.transform[5] }));
          for (const a of await page.getAnnotations()) {
            // The words that sit inside the note's rectangle, as the page draws them.
            const [x1, y1, x2, y2] = a.rect;
            const under = words.filter((w) => w.y >= y1 - 2 && w.y <= y2 + 2 && w.x >= x1 - 2 && w.x <= x2).map((w) => w.str).join(" ");
            all.push({ page: n, type: a.subtype, text: a.contentsObj?.str ?? "", author: a.titleObj?.str ?? "", under });
          }
        }
        await task.destroy();
        return all;
      };
      const out = `${store().root}\\out`;
      await invoke("file_create", { path: "out", isDir: true }).catch(() => {});
      const text = buffers.text("main.tex");
      const line = text.split("\n").findIndex((l) => l.includes("where $c_0$ is")) + 1;
      await invoke("comment_add", { path: "main.tex", anchor: { quote: "speed of light", before: "is the ", after: ".", line }, text: "Say which units." });
      await act.refreshComments();
      await act.compile();
      const comments = await invoke("pdf_save_with_comments", { dest: `${out}\\with comments.pdf` });
      const commented = await notesIn("out/with comments.pdf");
      await ok(
        comments >= 1 && commented.some((n) => n.type === "Highlight" && n.text.includes("Say which units.") && n.author === "Tamer" && n.under.includes("speed of light")),
        "a PDF with comments carries each open comment as a note a PDF viewer shows, on its passage",
      );
      const before = await invoke("history_snapshot", { label: "Before the summary" });
      buffers.change("main.tex", { from: buffers.text("main.tex").indexOf("where $c_0$ is"), insert: "A summary sentence written for the reader.\n\n" });
      await act.save();
      await act.compile();
      const marks = await invoke("pdf_save_with_changes", { version: before, label: "Before the summary", dest: `${out}\\changes.pdf` });
      const changed = await notesIn("out/changes.pdf");
      await ok(
        marks >= 1 && changed.some((n) => n.type === "Highlight" && n.text.startsWith("Written since Before the summary") && n.under.includes("summary sentence")),
        "a PDF with the changes since a version marks what was written since, where it prints",
      );
      // Pandoc is a separate program; without it, Word files are refused with how to get it.
      if (!(await invoke("pandoc_available"))) {
        const refused = await invoke("word_export", { dest: `${out}\\paper.docx`, bibliographies: [] }).then(
          () => null,
          (e) => e,
        );
        await ok(refused?.code === "no_pandoc" && /pandoc\.org/.test(refused.message), "with no Pandoc on the computer, Send to Word says where to get it");
      } else {
        const warnings = await invoke("word_export", { dest: `${out}\\paper.docx`, bibliographies: ["references.bib"] });
        const tree = JSON.stringify(await invoke("project_tree"));
        await ok(Array.isArray(warnings) && tree.includes("out/paper.docx"), "Send to Word makes a Word file of the document, with Pandoc");
        // And back: the Word file opens as a new project of its own, and compiles.
        await act.save();
        const made = await invoke("word_import", { source: `${out}\\paper.docx`, parentDir: work });
        await act.openProject(made.opened.root);
        await until("the project from Word", () => store().root === made.opened.root && store().tabs.length > 0);
        const fromWord = (await invoke("file_read", { path: "main.tex" })).text;
        await act.compile();
        await ok(
          /\\documentclass/.test(fromWord) && fromWord.includes("Lovelace") && /\\frac|\\textbf/.test(fromWord) && store().build.hasPdf && !store().build.diagnostics.some((d) => d.severity === "error"),
          "Open a Word file makes a new project of it, its text, formulas and references kept, and it compiles",
        );
      }
    }

    // Deleting a file takes a version first, so History can bring it back.
    {
      await invoke("file_create", { path: "scratch.tex", isDir: false });
      await writeOutside({ path: "scratch.tex", text: "Kept by History.\n" });
      await invoke("file_delete", { path: "scratch.tex" });
      const before = (await invoke("history_list")).versions.find((v) => v.label === "Before deleting scratch.tex");
      const kept = before && (await invoke("history_changed_files", { version: before.id, against: null }));
      await ok(!!before && JSON.stringify(kept).includes("scratch.tex"), "deleting a file takes a version first that holds it, so History can bring it back");
      await act.refreshTree();
    }

    // Opening another project saves what is not saved yet, rather than losing it.
    {
      const { buffers } = await import("/src/features/editor/buffers.ts");
      const path = store().active;
      buffers.goToLine(1);
      buffers.insert("% kept when another project opens\n");
      await until("a change not yet saved", () => store().tabs.some((t) => t.path === path && t.dirty));
      await act.openProject(store().root);
      const saved = (await invoke("file_read", { path })).text;
      await ok(saved.includes("% kept when another project opens"), "opening another project saves the changes not yet saved first");
    }

    // Another project can be opened in a window of its own.
    await click("File");
    (await until("the New window item", () => $$(".menu-item").find((i) => i.firstChild?.textContent === "New window"))).click();
    const labels = await until("a second window", async () => {
      const all = await window.emquad.windows();
      return all.length === 2 ? all : null;
    });
    await ok(labels.includes("main") && labels.some((l) => l.startsWith("w-")), "File, New window opens a window of its own for another project");

    await ok(failures.length === 0, `no script errors in the page${failures.length ? `: ${failures.join(" | ")}` : ""}`);
    await log(`PASS: all ${step} checks passed`);
    await invoke("e2e_exit", { code: 0 });
  } catch (e) {
    await log(`FAIL: ${e?.message ?? e}${failures.length ? ` (page errors: ${failures.join(" | ")})` : ""}`);
    await invoke("e2e_exit", { code: 1 });
  }
})();
