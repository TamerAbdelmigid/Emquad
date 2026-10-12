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

    // --- compile
    await click("Recompile");
    await until("a rendered PDF page", () => $(".pdf-page canvas"), 180000);
    await status("Compiled");
    await ok(true, "Recompile produces a PDF and the status reads Compiled");
    await ok(document.documentElement.scrollHeight <= window.innerHeight, "the window does not scroll");
    await shot("02-editor");

    // --- an edit marks the tab unsaved
    const { buffers } = await import("/src/features/editor/buffers.ts");
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

    $(".opt.theirs").click();
    await until("Finish merge to unlock", () => !button("Finish merge").disabled);
    await click("Finish merge");
    await until("the review to close", () => !$(".changes"));
    const merged = (await invoke("file_read", { path: "main.tex" })).text;
    await ok(
      merged.includes("said Lina") && merged.includes("tightened by Lina") && !merged.includes("said Tamer"),
      "the merge wrote what was chosen",
    );
    const list = await invoke("history_list");
    await ok(list.versions[0].kind === "merge" && list.versions[0].parents.length === 2, "History records the merge with both parents");
    await ok(list.versions.every((v) => !v.pending), "no bundle is left waiting");
    await sleep(600);
    await ok(!$(".toast.error"), "finishing the merge raises no error notice");
    await shot("06-history");

    await click("Back to editor");
    await until("the merged text in the editor", () => text(".cm-content").includes("said Lina"));
    await ok(true, "the editor shows the merged file");

    await ok(failures.length === 0, `no script errors in the page${failures.length ? `: ${failures.join(" | ")}` : ""}`);
    await log(`PASS: all ${step} checks passed`);
    await invoke("e2e_exit", { code: 0 });
  } catch (e) {
    await log(`FAIL: ${e?.message ?? e}${failures.length ? ` (page errors: ${failures.join(" | ")})` : ""}`);
    await invoke("e2e_exit", { code: 1 });
  }
})();
