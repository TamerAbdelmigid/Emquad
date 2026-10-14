// The in-page half of the keyboard pass (scripts/keyboard.mjs): sets up a project with a table,
// says READY, and waits for the driver to finish. Run by a debug build when EMQUAD_E2E points at it.
(async () => {
  if (window.__E2E_RUNNING) return;
  window.__E2E_RUNNING = true;
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const log = (line) => invoke("e2e_log", { line });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    while (!window.emquad) await sleep(100);
    const { act, store } = window.emquad;
    await invoke("settings_update", { displayName: "Keyboard" });
    store().set({ settings: await invoke("settings_get") });
    const p = await invoke("project_create", { parentDir: window.__E2E_WORK, name: "keys", template: "article" });
    await act.openProject(p.root);
    const B = String.fromCharCode(92);
    const text = (await invoke("file_read", { path: "main.tex" })).text.replace(
      "Start writing here.",
      `Start writing here.\n\n${B}begin{tabular}{|l|l|}\n${B}hline\nA & B ${B}${B}\nC & D ${B}${B}\n${B}hline\n${B}end{tabular}\n`,
    );
    await invoke("file_write", { path: "main.tex", text });
    await sleep(1500);
    await log("READY");
    while (!window.__KB_DONE) await sleep(300);
    await log(window.__KB_DONE);
  } catch (e) {
    await log("FAIL: " + (e?.stack ?? e));
  }
  await invoke("e2e_exit", { code: String(window.__KB_DONE).startsWith("PASS") ? 0 : 1 });
})();
