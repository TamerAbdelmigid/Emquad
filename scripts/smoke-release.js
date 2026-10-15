// Smoke test for the packaged app: the production frontend, the security policy it runs under,
// the bundled fonts, the PDF viewer and the bundled compiler. It needs a release build that
// includes the test harness, which the installer never does:
//
//   pnpm tauri build --no-bundle --features e2e
//   $env:EMQUAD_E2E = "$PWD\scripts\smoke-release.js"
//   $env:EMQUAD_E2E_WORK = (New-Item -ItemType Directory "$env:TEMP\emquad-smoke-$(Get-Random)").FullName
//   $env:EMQUAD_E2E_OUT = "$env:EMQUAD_E2E_WORK\result.log"
//   .\src-tauri\target\release\emquad.exe
//
// Run it a second time with the path of "<work>\smoke.emquad" as the only argument to check
// that the app opens a bundle it is started with, as Explorer does on a double-click.
//
// Unlike scripts/e2e.js this uses only what a user's build has: the page and the commands.
(async () => {
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const log = (line) => invoke("e2e_log", { line });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const text = (selector) => $(selector)?.textContent ?? "";
  // The project's main file is in the editor: as source, or in visual mode, where a project
  // opens, with its settings folded into one line named by its title.
  const editorShows = (title) => text(".cm-content").includes("\\documentclass") || text(".cm-v-fold").includes(title);
  let step = Number(sessionStorage.getItem("smoke-step") ?? 0);

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
    sessionStorage.setItem("smoke-step", String(step));
    if (!condition) throw new Error(`check ${step} failed: ${what}`);
    await log(`ok ${step} - ${what}`);
  }
  const button = (label) =>
    $$("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === label);

  const failures = [];
  window.addEventListener("error", (e) => failures.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => failures.push(String(e.reason?.message ?? e.reason)));
  document.addEventListener("securitypolicyviolation", (e) => failures.push(`blocked by policy: ${e.violatedDirective} ${e.blockedURI}`));

  try {
    const work = window.__E2E_WORK;
    if (!work) throw new Error("EMQUAD_E2E_WORK is not set");
    const phase = sessionStorage.getItem("smoke-phase") ?? "start";
    const known = (await invoke("settings_get")).recent.length > 0;

    if (phase === "start" && known) {
      // Second run: the app was started with a bundle that belongs to the project made earlier.
      await until("the app to act on the bundle", () => /already part of your project/.test(text(".toast")), 60000);
      await ok(true, "started with a bundle, the app found its project and saw the bundle is already merged");
      await ok(editorShows("smoke paper"), "with the project open in the editor");
      await log(`PASS: all ${step} checks passed`);
      return invoke("e2e_exit", { code: 0 });
    }

    if (phase === "start") {
      await invoke("settings_update", { displayName: "Smoke" });
      await invoke("project_create", { parentDir: work, name: "smoke paper", template: "article" });
      await invoke("project_close");
      sessionStorage.setItem("smoke-phase", "open");
      location.reload();
      return;
    }

    // --- the start screen lists the project; open it the way a user would
    const recent = await until("the recent project", () => $$(".recent").find((b) => b.textContent.includes("smoke paper")));
    await ok(!$("dialog[open]"), "the start screen shows without the welcome prompt once a name is set");
    recent.click();
    await until("the editor", () => editorShows("smoke paper"));
    await ok(true, "a recent project opens in the editor");

    await document.fonts.ready;
    await ok(
      document.fonts.check('600 14px "Hanken Grotesk"') && document.fonts.check('400 13px "Geist Mono"'),
      "the bundled fonts are loaded",
    );

    (await until("the Recompile button", () => button("Recompile"))).click();
    await until("a rendered PDF page", () => $(".pdf-page canvas"), 300000);
    await until("the Compiled status", () => text(".proj .st") === "Compiled", 300000);
    await ok(true, "Recompile produces a PDF in the packaged app");
    const canvas = $(".pdf-page canvas");
    await until("the page to be painted", () => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4 * 97) if (data[i] < 128 && data[i + 3] > 0) return true;
      return false;
    });
    await ok(true, "the PDF viewer has drawn text on the page");
    await ok(text(".sfoot").includes("Tectonic engine"), "the bundled Tectonic did the compiling");
    await ok(text(".sfoot").includes("texlab"), "the bundled texlab is running");

    // Visual mode brings its own stylesheet and fonts, which must load under the security policy.
    button("Visual").click();
    await until("visual mode", () => $(".cm-visual .cm-v-h1"));
    await ok((await document.fonts.load('16px "KaTeX_Main"')).length > 0, "visual mode draws headings and its mathematics font can be loaded");
    button("Code").click();

    // Spelling: the dictionary is a large file loaded on demand, which must work when packaged.
    // Pasted where the cursor is, as a user would: a file written by the app itself is not read
    // back into the editor, which has the text already.
    const words = new DataTransfer();
    words.setData("text/plain", "A sentense to check. ");
    $(".cm-content").focus();
    $(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: words, bubbles: true, cancelable: true }));
    await until("the misspelled word to be underlined", () => $$(".cm-misspelled").some((w) => w.textContent === "sentense"), 30000);
    await ok(true, "the bundled dictionary loads and a misspelled word is underlined");

    const sent = await invoke("bundle_export", { dest: `${work}\\smoke.emquad`, note: "", includePdf: true, includePackages: true, includeComments: true });
    await ok(sent.includes.pdf, "a bundle with the PDF can be exported");
    await ok(sent.includes.packages, "and it carries the LaTeX packages, checked to compile with no internet");
    await ok(failures.length === 0, `no script errors or policy violations${failures.length ? `: ${failures.join(" | ")}` : ""}`);
    await log(`PASS: all ${step} checks passed`);
    await invoke("e2e_exit", { code: 0 });
  } catch (e) {
    await log(`FAIL: ${e?.message ?? e}${failures.length ? ` (page errors: ${failures.join(" | ")})` : ""}`);
    await invoke("e2e_exit", { code: 1 });
  }
})();
