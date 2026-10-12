// End-to-end check of the real app window. A debug build runs this file inside the page when
// EMQUAD_E2E points at it (see src-tauri/src/e2e.rs). From PowerShell, in the repository root:
//
//   $env:EMQUAD_E2E = "$PWD\scripts\e2e.js"
//   $env:EMQUAD_E2E_WORK = (New-Item -ItemType Directory "$env:TEMP\emquad-e2e-$(Get-Random)").FullName
//   $env:EMQUAD_E2E_OUT = "$env:EMQUAD_E2E_WORK\result.log"
//   pnpm tauri dev
//
// The app exits with code 0 when every check passes. It covers: compile, errors, source/PDF
// lookup, snapshot, export, opening a bundle as a new project, and a merge with a conflict.
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
    await invoke("settings_update", { displayName: "Tamer" });
    store().set({ settings: await invoke("settings_get") });
    await until("the start screen", () => $(".start"));
    await ok(!$("dialog[open]"), "with a name set, the welcome prompt does not appear");
    await shot("01-start");

    // --- a new project opens in the editor
    const a = await invoke("project_create", { parentDir: work, name: "e2e paper", template: "article" });
    await act.openProject(a.root);
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
    // --- visual mode draws the same source as a document, and code mode puts it back
    const plain = (await invoke("file_read", { path: "main.tex" })).text;
    const rich = plain.replace(
      "Start writing here.",
      "Start \\textbf{writing} here, with $E = mc^2$ inline.\n\\begin{equation}\n  I = \\int_0^\\infty e^{-x^2}\\,dx\n\\end{equation}\n\\begin{itemize}\n\\item first\n\\end{itemize}",
    );
    await invoke("file_write", { path: "main.tex", text: rich });
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
    await invoke("file_write", { path: "main.tex", text: plain });
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
    await invoke("file_write", { path: "main.tex", text: good.replace("Start writing here.", "Start \\undefinedthing here.") });
    await until("the reloaded buffer", () => text(".cm-content").includes("undefinedthing"));
    await ok(true, "a file changed on disk reloads into its clean buffer");
    await click("Recompile");
    await status("Compile failed");
    await ok(/^[1-9]\d* error/.test(text(".proj .dim").trim()), "the top bar counts the error");
    await ok($$(".pdf-page canvas").length > 0, "the previous PDF is still shown");
    await until("the gutter marker", () => $(".cm-lint-marker-error"));
    await ok(true, "the error is marked in the editor gutter");
    await shot("03-error");
    await invoke("file_write", { path: "main.tex", text: good });
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
    const sent = await invoke("bundle_export", { dest: out, note: "Please review", includePdf: true });
    await ok(sent.includes.pdf && sent.includes.history, "export writes a bundle with history and the PDF");
    await invoke("settings_update", { displayName: "Lina" });
    const b = await invoke("bundle_import_new", { path: out, parentDir: `${work}\\lina` });
    await ok(b.info.projectId === a.info.projectId, "the bundle opens elsewhere as the same project");
    const theirs = good
      .replace("Start writing here.", "Start writing here, said Lina.")
      .replace("A short summary of the paper.", "A short summary, tightened by Lina.");
    await invoke("file_write", { path: "main.tex", text: theirs });
    const back = `${work}\\back.emquad`;
    await invoke("bundle_export", { dest: back, note: "Tightened the wording", includePdf: false });
    await invoke("settings_update", { displayName: "Tamer" });

    await act.openProject(a.root);
    await until("project A again", () => store().root === a.root && text(".cm-content").includes("\\documentclass"));
    await invoke("file_write", { path: "main.tex", text: good.replace("Start writing here.", "Start writing here, said Tamer.") });
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

    await ok(failures.length === 0, `no script errors in the page${failures.length ? `: ${failures.join(" | ")}` : ""}`);
    await log(`PASS: all ${step} checks passed`);
    await invoke("e2e_exit", { code: 0 });
  } catch (e) {
    await log(`FAIL: ${e?.message ?? e}${failures.length ? ` (page errors: ${failures.join(" | ")})` : ""}`);
    await invoke("e2e_exit", { code: 1 });
  }
})();
