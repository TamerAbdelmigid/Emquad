// The keyboard pass: uses the app with real key presses only, and checks where the keyboard
// goes. The presses are sent over WebView2's debugging port, so they are trusted by the page
// (Tab really moves the focus) and never reach any other window on the computer.
//
// From PowerShell, in the repository root:
//
//   $env:EMQUAD_E2E = "$PWD\scripts\keyboard-setup.js"
//   $env:EMQUAD_E2E_WORK = (New-Item -ItemType Directory "$env:TEMP\emquad-kb-$(Get-Random)").FullName
//   $env:EMQUAD_E2E_OUT = "$env:EMQUAD_E2E_WORK\result.log"
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//   pnpm tauri dev
//
// and, once the result log says READY, in a second terminal:
//
//   node scripts/keyboard.mjs 9333
//
// It prints each check and ends with PASS or FAIL; the app exits with code 0 when all pass.
const port = process.argv[2] ?? "9333";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && /localhost:1420|tauri/.test(t.url)) ?? targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

const CODES = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, F10: 121, "=": 187, Alt: 18 };
async function key(name, mods = {}) {
  const modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.shift ? 8 : 0);
  const code = CODES[name] ?? name.toUpperCase().charCodeAt(0);
  const base = { key: name, code: name === "=" ? "Equal" : name === "Alt" ? "AltLeft" : name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  if (name === "Enter") await send("Input.dispatchKeyEvent", { type: "char", text: "\r", ...base });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(150);
}
/** Type each character as its own key press, as a person does, so that what reacts to keys sees them. */
const typeKeys = async (text) => {
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(40);
  }
  await sleep(150);
};
const typeText = async (text) => {
  await send("Input.insertText", { text });
  await sleep(150);
};
/** Whether the element that has the keyboard matches `selector`. */
const focusIs = (selector) => evaluate(`!!document.activeElement?.matches(${JSON.stringify(selector)})`);
const focusIn = (selector) => evaluate(`!!document.activeElement?.closest(${JSON.stringify(selector)})`);
const focusName = () => evaluate("(document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 40)");

let step = 0;
const failures = [];
async function check(condition, what) {
  step++;
  const line = `${condition ? "ok" : "not ok"} ${step} - ${what}`;
  console.log(line);
  if (!condition) failures.push(line);
}

for (let i = 0; i < 200 && !(await evaluate("!!(window.emquad && window.emquad.store().root)")); i++) await sleep(300);
await sleep(1500);

// Tab alone reaches every part of the screen, each control named.
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("Escape");
const reached = new Set();
let unnamed = 0;
for (let i = 0; i < 80; i++) {
  await key("Tab");
  const info = await evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return null;
    // Each part of the screen, known by a control only it has.
    const area = el.matches(".rb") ? "rail" : el.matches(".file-main") ? "files" : el.closest(".stabs") ? "tabs" : el.closest(".tools, .ribbon") ? "toolbar" : el.closest(".cm-editor") ? "editor" : el.matches("button.menu") ? "menus" : el.matches(".zoomv, [aria-label='Zoom in']") ? "pdf" : el.className?.split?.(" ")[0] ?? "";
    const named = !!(el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.trim() || (el.id && document.querySelector('label[for="' + el.id + '"]')));
    return { area, named }; })()`);
  if (!info) continue;
  reached.add(info.area);
  if (!info.named) unnamed++;
}
await check(unnamed === 0, `every control Tab reaches has a name${unnamed ? ` (${unnamed} without)` : ""}`);
for (const area of ["menus", "rail", "files", "tabs", "toolbar", "editor", "pdf"]) await check([...reached].some((a) => a.includes(area)), `Tab reaches the ${area} (reached: ${[...reached].join(", ")})`);

// Into the editor and out: Esc, then Tab.
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("Escape");
await key("Tab");
await check(!(await focusIn(".cm-editor")) || (await focusIs(".cm-v-tedit")), "Esc then Tab leaves the editor");

// A menu.
await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Insert').focus(); true");
await key("Enter");
await check(await focusIs(".menu-item"), "Enter opens a menu with the keyboard on its first item");
await key("ArrowDown");
await check(await focusIs(".menu-item"), "the arrow keys move along it");
await key("Escape");
await check((await focusName()) === "Insert", "Escape closes it and gives the keyboard back to its button");

// A dialog.
await evaluate("document.querySelector('.rb[aria-label=Settings]').focus(); true");
await key("Enter");
await sleep(300);
await check(await focusIn("dialog[open]"), "Enter on Settings opens it with the keyboard inside");
for (let i = 0; i < 12; i++) await key("Tab");
await check((await focusIn("dialog[open]")) || (await evaluate("document.activeElement === document.body")), "Tab stays inside the dialog");
await key("Escape");
await sleep(300);
await check((await focusName()) === "Settings", "Escape closes it and gives the keyboard back to the Settings button");

// A dialog opened from a menu gives the keyboard back to the menu's button.
await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Help').focus(); true");
await key("Enter");
await key("ArrowDown");
await check((await focusName()) === "Settings…", "the arrow keys reach Settings… in the Help menu");
await key("Enter");
await sleep(300);
await check(await focusIn("dialog[open]"), "Enter on it opens Settings");
await key("Escape");
await sleep(300);
await check((await focusName()) === "Help", "Escape closes it and gives the keyboard back to the Help menu's button");

// In a narrow pane the ribbon's groups fold to fit: Enter opens one, a tool in it is used with
// Enter, and Escape puts it away.
if (await evaluate("!!document.querySelector('#rb-panel')")) {
  await evaluate("(() => { const s = window.emquad.store(); window.__kbWas = { filesWidth: s.filesWidth, split: s.split }; s.set({ filesWidth: 480, split: 0.3 }); return true; })()");
  await sleep(800);
  const doc = "(await import('/src/features/editor/buffers.ts')).buffers";
  const bold = `(async () => (${doc}).text('main.tex').includes(String.fromCharCode(92) + 'textbf{Start}'))()`;
  // The group that holds Bold: Font, folded, or More, which holds it whole.
  const fold = "[...document.querySelectorAll('.rb-folded')].find((g) => g.dataset.label === 'Font' || g.classList.contains('rb-more')).querySelector('.rb-fold')";
  await evaluate(`(async () => { const b = ${doc}; const at = b.text('main.tex').indexOf('Start writing'); b.run((v) => (v.dispatch({ selection: { anchor: at, head: at + 5 } }), true)); return true; })()`);
  await evaluate(`${fold}.focus(); true`);
  await key("Enter");
  await sleep(300);
  await check(await focusIn(".rb-pop"), "Enter on a folded ribbon group opens its tools with the keyboard in them");
  for (let i = 0; i < 40 && (await focusName()) !== "Bold" && (await focusIn(".rb-pop")); i++) await key("Tab");
  await key("Enter");
  await sleep(400);
  await check((await evaluate(bold)) && (await evaluate("!document.querySelector('.rb-pop')")), "Enter on a tool among them uses it, and puts them away");
  await evaluate("document.querySelector('.cm-content').focus(); true");
  await key("z", { ctrl: true });
  await sleep(300);
  await evaluate(`${fold}.focus(); true`);
  await key("Enter");
  await sleep(300);
  await key("Escape");
  await sleep(200);
  await check(await focusIs(".rb-fold"), "Escape puts them away and gives the keyboard back to the group's button");
  await check(!(await evaluate(bold)), "and the bold was undone");
  // Nothing left selected, so that Escape in the text is free to hand Tab to the page, as it was.
  await evaluate(`(async () => { const b = ${doc}; b.run((v) => (v.dispatch({ selection: { anchor: 0 } }), true)); return true; })()`);
  // From here on the ribbon's tools are reached in their places, so each group is drawn whole:
  // the editor has the window to itself, beside the file panel.
  await evaluate("(window.emquad.store().set({ ...window.__kbWas, layout: 'editor' }), true)");
  await sleep(800);
}

// The symbol panel. In the page view it is on the ribbon's Insert tab, chosen with Enter.
if (await evaluate("!!document.querySelector('#rb-tab-insert')")) {
  await evaluate("document.querySelector('#rb-tab-insert').focus(); true");
  await key("Enter");
  await check(await evaluate("document.querySelector('#rb-tab-insert').getAttribute('aria-selected') === 'true'"), "Enter on a ribbon tab shows its tools");
}
await evaluate("document.querySelector('.sym-btn').focus(); true");
await key("Enter");
await sleep(300);
await check(await focusIs(".sym-search"), "Enter on Ω opens the symbol panel in its search box");
await typeText("arrow");
await key("ArrowDown");
await check(await focusIn(".sym-grid"), "the down arrow goes to the symbols");
await key("ArrowRight");
await check(await focusIn(".sym-grid"), "the arrow keys move among them");
await key("Enter");
await sleep(300);
await check(!(await evaluate("!!document.querySelector('.sym-pop')")) && (await evaluate("window.emquad.store().tabs[0]?.dirty")), "Enter puts the symbol in and closes the panel");

// The equation editor, from the text with Alt+= as in Word.
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("=", { alt: true });
await sleep(400);
await sleep(1200);
await check(await focusIs("math-field"), "Alt+= opens the equation editor with the keyboard in its formula");
// Typed as in Word: a name becomes its symbol.
await typeKeys("alpha+1");
await check(/\\alpha\+1/.test(await evaluate("document.querySelector('math-field').getValue('latex')")), "typing alpha in the formula makes α, as in Word");
await key("Enter", { ctrl: true });
await sleep(400);
await check(!(await evaluate("!!document.querySelector('dialog[open]')")) && (await focusIn(".cm-editor")), "Ctrl+Enter puts the formula in and gives the keyboard back to the text");

// Visual mode and a table.
await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Visual').focus(); true");
await key("Enter");
await sleep(800);
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("Escape");
for (let i = 0; i < 6 && !(await focusIs(".cm-v-tedit")); i++) await key("Tab");
await check(await focusIs(".cm-v-tedit"), "Tab from the text reaches the table");
await check(await evaluate("getComputedStyle(document.activeElement).outlineStyle !== 'none'"), "a table with the keyboard on it is marked");
await key("Enter");
await check(await evaluate("!!document.querySelector('.cm-v-tedit td.cur')"), "Enter selects its first cell");
await key("ArrowRight");
await key("Enter");
await check(await focusIs("input.cm-v-tcell"), "the arrow keys move between cells, and Enter starts typing in one");
await typeText("X");
await key("Tab");
await check(await focusIs("input.cm-v-tcell"), "Tab moves to the next cell");
await key("Escape");
await key("F10", { shift: true });
await sleep(300);
await check(await focusIn(".cm-v-tmenu"), "Shift+F10 opens the table's menu with the keyboard in it");
await key("Escape");
await check(await focusIs(".cm-v-tedit"), "Escape closes it and returns to the table");

// A double-click with the mouse on a formula drawn in visual mode opens the equation editor on
// it, as in Word; Esc in the formula closes the editor, as in every dialog.
const at = await evaluate(`(() => { const m = [...document.querySelectorAll('.cm-v-math')].find((e) => e.textContent.includes('β')); if (!m) return null; m.scrollIntoView({ block: 'center' }); const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await sleep(300);
if (at) {
  for (const clickCount of [1, 2]) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount });
    await sleep(80);
  }
  await sleep(1200);
}
await check(
  !!at && /\\beta/.test((await evaluate("document.querySelector('math-field')?.getValue('latex') ?? ''")) ?? ""),
  "a double-click with the mouse on a formula in visual mode opens the equation editor on it",
);
await key("Escape");
await sleep(300);
await check(!(await evaluate("!!document.querySelector('dialog[open]')")), "Esc in the formula closes the equation editor");

// The page view's right-click menu, a ribbon menu, and a format from its keys.
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("F10", { shift: true });
await sleep(300);
await check(await focusIn(".page-menu"), "Shift+F10 in the page opens the right-click menu with the keyboard in it");
await key("ArrowDown");
await check(await focusIs(".page-menu [role=menuitem]"), "the arrow keys move along it");
await key("Escape");
await sleep(200);
await check(!(await evaluate("!!document.querySelector('.page-menu')")) && (await focusIn(".cm-editor")), "Escape closes it and gives the keyboard back to the text");
await evaluate("document.querySelector('#rb-tab-home').focus(); true");
await key("Enter");
await evaluate("document.querySelector('[aria-label=\"Font colour\"]').focus(); true");
await key("Enter");
await check(await focusIs(".menu-item"), "Enter on Font colour opens the palette with the keyboard on its first colour");
await key("Escape");
await check((await focusName()) === "Font colour", "Escape closes the palette and gives the keyboard back to Font colour");
// The Layout tab, chosen with Enter; its Margins menu opened and closed from the keyboard.
await evaluate("document.querySelector('#rb-tab-layout').focus(); true");
await key("Enter");
await check(await evaluate("document.querySelector('#rb-tab-layout').getAttribute('aria-selected') === 'true'"), "Enter on the Layout tab shows its tools");
for (let i = 0; i < 8 && (await focusName()) !== "Margins"; i++) await key("Tab");
await check((await focusName()) === "Margins", "Tab from the Layout tab reaches Margins");
await key("Enter");
await check(await focusIs(".menu-item"), "Enter on Margins opens its menu with the keyboard on the first choice");
await key("Escape");
await check((await focusName()) === "Margins", "Escape closes it and gives the keyboard back to Margins");
// The Review tab's Show changes menu, and Ctrl+K for a link, from the keyboard.
await evaluate("document.querySelector('#rb-tab-review').focus(); true");
await key("Enter");
await check(await evaluate("document.querySelector('#rb-tab-review').getAttribute('aria-selected') === 'true'"), "Enter on the Review tab shows its tools");
for (let i = 0; i < 16 && (await focusName()) !== "Show changes"; i++) await key("Tab");
await key("Enter");
await check(await focusIs(".menu-item"), "Enter on Show changes opens its list of snapshots with the keyboard in it");
await key("Escape");
await check((await focusName()) === "Show changes", "Escape closes it and gives the keyboard back to Show changes");
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("K", { ctrl: true });
await sleep(300);
await check(await focusIs("#link-address"), "Ctrl+K in the text opens the Link dialog with the keyboard in its address");
await key("Escape");
await sleep(300);
await check(!(await evaluate("!!document.querySelector('dialog[open]')")), "Escape closes it");
// KeyTips: Alt alone, then X for the LaTeX tab, then the letter of its Split tool.
await evaluate("document.querySelector('.cm-content').focus(); true");
await key("Alt", { alt: true });
await check(await evaluate("[...document.querySelectorAll('.rb-kt')].some((k) => k.textContent === 'X')"), "Alt pressed alone shows KeyTips on the ribbon's tabs");
await key("x");
await check(await evaluate("document.querySelector('#rb-tab-latex').getAttribute('aria-selected') === 'true' && document.querySelectorAll('.rb-kt').length > 3"), "X chooses the LaTeX tab and shows a letter on each of its tools");
const splitKey = await evaluate("[...document.querySelectorAll('.rb-kt')].find((k) => Math.abs(k.getBoundingClientRect().left + 7 - (document.querySelector('[aria-label=\"Split with LaTeX\"]').getBoundingClientRect().left + document.querySelector('[aria-label=\"Split with LaTeX\"]').getBoundingClientRect().width / 2)) < 2)?.textContent");
await key(String(splitKey).toLowerCase());
await sleep(400);
await check(await evaluate("!!document.querySelector('.cm-latex-host .cm-content') && !document.querySelector('.rb-kt')"), `its letter (${splitKey}) uses the tool: the LaTeX is shown beside the page`);
// Typing on the LaTeX side, a tool used by its letter gives the keyboard back there.
const tipOf = (label) =>
  evaluate(`(() => { const tool = document.querySelector('[aria-label=${JSON.stringify(label)}]').getBoundingClientRect(); return [...document.querySelectorAll('.rb-kt')].find((k) => Math.abs(k.getBoundingClientRect().left + 7 - (tool.left + tool.width / 2)) < 2)?.textContent; })()`);
await evaluate("document.querySelector('.cm-latex-host .cm-content').focus(); true");
for (const turn of ["on", "off"]) {
  await key("Alt", { alt: true });
  await key("x");
  const marksKey = await tipOf("LaTeX marks");
  await key(String(marksKey).toLowerCase());
  await sleep(300);
  await check((await focusIn(".cm-latex-host")) && !(await evaluate("!!document.querySelector('.rb-kt')")), `LaTeX marks by its letter (${marksKey}), turned ${turn} while typing on the LaTeX side, gives the keyboard back to the LaTeX side`);
}
await evaluate("document.querySelector('[aria-label=\"Split with LaTeX\"]').focus(); true");
await key("Enter");
await sleep(300);
await check(!(await evaluate("!!document.querySelector('.cm-latex-host')")), "Enter on Split with LaTeX puts the LaTeX away again");
await evaluate("document.querySelector('#rb-tab-home').focus(); true");
await key("Enter");
// The word is selected by the script; the format comes from the key press.
await evaluate(`(async () => { const { buffers } = await import("/src/features/editor/buffers.ts"); const path = window.emquad.store().active; const at = buffers.text(path).indexOf("Start writing"); buffers.run((v) => (v.dispatch({ selection: { anchor: at, head: at + 5 } }), true)); return true; })()`);
await sleep(200);
await key("=", { ctrl: true });
await sleep(300);
await check(await evaluate("window.emquad.store().tabs.some((t) => t.dirty) && document.querySelector('.cm-v-sub')?.textContent === 'Start'"), "Ctrl+= sets the selected word as a subscript, drawn lowered");

// Typing at the edge of bold with real key presses: it goes on in the formatting of the letter before it, as in Word.
const inPage = (body) => `(async () => { const { buffers } = await import("/src/features/editor/buffers.ts"); const path = window.emquad.store().active; const v = buffers.showNow(path); const B = String.fromCharCode(92); ${body} })()`;
await evaluate(inPage(`const at = v.state.doc.toString().indexOf(", with a formula"); v.dispatch({ changes: { from: at, insert: " and " + B + "textbf{bold}" }, userEvent: "input" }); v.dispatch({ selection: { anchor: at + 5 + B.length + "textbf{bold}".length } }); v.focus(); return true;`));
await sleep(300);
await typeKeys("er(s)");
await check(await evaluate(inPage(`return v.state.doc.toString().includes(" and " + B + "textbf{bolder(s)}, with");`)), "typed after a bold word's hidden brace, letters go on in bold, a bracket closing itself there once");
await evaluate(inPage(`v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf(B + "textbf{bolder(s)}") + B.length + 7 } }); v.focus(); return true;`));
await sleep(200);
await typeKeys("so ");
await check(await evaluate(inPage(`return v.state.doc.toString().includes(" and so " + B + "textbf{bolder(s)}, with");`)), "typed after a plain word just before a bold one, letters stay plain");
await evaluate(inPage(`const t = v.state.doc.toString(); const at = t.indexOf(" and so "); v.dispatch({ changes: { from: at, to: t.indexOf(", with a formula"), insert: "" }, userEvent: "input" }); return true;`));

// History.
await key("H", { ctrl: true, shift: true });
await sleep(800);
await check(await focusIn(".hist"), "Ctrl+Shift+H opens History with the keyboard in it");
for (let i = 0; i < 14 && !(await evaluate("document.activeElement?.textContent?.trim() === 'Back to editor'")); i++) await key("Tab");
await check(await evaluate("document.activeElement?.textContent?.trim() === 'Back to editor'"), "Tab reaches Back to editor");
await key("Enter");
await sleep(500);
await check(await evaluate("!!document.querySelector('.cm-content')"), "and Enter on it goes back");

const verdict = failures.length ? `FAIL: ${failures.length} of ${step} checks failed` : `PASS: all ${step} checks passed`;
console.log(verdict);
await evaluate(`window.__KB_DONE = ${JSON.stringify(verdict)}; true`);
ws.close();
process.exit(failures.length ? 1 : 0);
