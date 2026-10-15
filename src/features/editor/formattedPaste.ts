// Text pasted with its formatting from Word, Google Docs or a web page: bold, italic, underline,
// superscript and subscript, headings, bulleted and numbered lists and links written as the
// LaTeX for them, and the characters LaTeX treats specially written so that they print.
// Colours, fonts and sizes are left behind, as a LaTeX document sets those itself.

/** How each character LaTeX treats specially is written to print as itself. */
const PRINTED: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\\": "\\textbackslash{}",
};

/** Text with each character LaTeX treats specially written so that it prints as itself. */
export const printed = (text: string) => text.replace(/[&%$#_{}~^\\]/g, (ch) => PRINTED[ch]);

/** What a paste with formatting comes to: the LaTeX, and the packages it needs. */
export interface Formatted {
  latex: string;
  packages: string[];
}

/** One paragraph, heading or list item of what was pasted. */
interface Block {
  text: string;
  heading?: number;
  item?: { ordered: boolean; level: number };
}

/** Formatting in force where some text is, so that it is not written twice. */
interface Formats {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  script?: boolean;
}

/** Elements that begin a paragraph of their own. */
const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|FIGCAPTION|DT|DD|ADDRESS)$/;
/** The same, with lists, as a selector. */
const BLOCK_SELECTOR = "p,div,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,pre,section,article,header,footer,main,aside,nav,figure,figcaption,dt,dd,address";
/** Elements whose content is not text of the document. */
const SKIPPED = /^(STYLE|SCRIPT|HEAD|META|TITLE|LINK|TEMPLATE|NOSCRIPT|IMG|SVG|OBJECT|IFRAME|O:P|XML|BUTTON|INPUT|SELECT|TEXTAREA)$/;
const COMMANDS = ["\\section", "\\subsection", "\\subsubsection", "\\paragraph"];

/** The value of one property in an element's inline style, lower-cased. */
const styleOf = (el: Element, property: string) =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(el.getAttribute("style") ?? "")?.[1].trim().toLowerCase() ?? "";

/** Whether an element is one of Word's list paragraphs, and its level and kind. */
function wordListItem(el: Element): Block["item"] | null {
  const list = styleOf(el, "mso-list");
  if (!list || list === "ignore" || !/level\d/.test(list)) return null;
  const level = Number(/level(\d+)/.exec(list)?.[1] ?? 1);
  // Word writes the number or bullet itself, in a span it marks to be ignored.
  const marker = [...el.querySelectorAll("span")].find((s) => styleOf(s, "mso-list") === "ignore")?.textContent?.trim() ?? "";
  return { ordered: /^\(?(?:\d+|[a-z]|[ivxlcdm]+)[.)]/i.test(marker), level };
}

/**
 * The LaTeX for HTML from the clipboard, or null when it holds nothing a plain paste would not
 * keep (no formatting, headings or lists), or a table, which is pasted as a table elsewhere.
 */
export function formattedPaste(html: string): Formatted | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body || body.querySelector("table")) return null;
  const packages = new Set<string>();
  let formatted = false;
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (current) {
      const text = current.text.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ ...current, text });
    }
    current = null;
  };
  const add = (text: string) => {
    // A line break at the level of the paragraph ends it; inside bold or a link it is a space.
    const [first, ...rest] = text.split("\n");
    current ??= { text: "" };
    current.text += first;
    for (const part of rest) {
      const was: Block = current ?? { text: "" };
      flush();
      current = { text: part, heading: was.heading, item: undefined };
    }
  };

  /** The text of an element and what is inside it, with its formatting written as LaTeX. */
  const inline = (node: Node, f: Formats, top: boolean): string => {
    if (node.nodeType === 3) return printed((node.textContent ?? "").replace(/\s+/g, " "));
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIPPED.test(tag) || styleOf(el, "mso-list") === "ignore" || styleOf(el, "display") === "none") return "";
    if (tag === "BR") return top ? "\n" : " ";
    const weight = styleOf(el, "font-weight");
    const align = styleOf(el, "vertical-align");
    // A weight given outright says what it is, even on <b>: Google Docs wraps all it copies in
    // <b style="font-weight:normal">.
    const light = weight === "normal" || weight === "lighter" || (weight !== "" && Number(weight) < 600);
    const bold = !f.bold && !light && (tag === "B" || tag === "STRONG" || weight === "bold" || weight === "bolder" || Number(weight) >= 600);
    const italic = !f.italic && (tag === "I" || tag === "EM" || tag === "CITE" || styleOf(el, "font-style") === "italic");
    const underline = !f.underline && (tag === "U" || tag === "INS" || styleOf(el, "text-decoration").includes("underline") || styleOf(el, "text-decoration-line").includes("underline"));
    const sup = !f.script && (tag === "SUP" || align === "super");
    const sub = !f.script && (tag === "SUB" || align === "sub");
    const inner: Formats = { bold: f.bold || bold, italic: f.italic || italic, underline: f.underline || underline, script: f.script || sup || sub };
    const wrapped = bold || italic || underline || sup || sub || tag === "A";
    let text = [...el.childNodes].map((child) => inline(child, inner, top && !wrapped)).join("");
    if (!text.trim()) return text;
    // Spaces at the edges stay outside the command, where they read as spaces between words.
    const lead = text.slice(0, text.length - text.trimStart().length);
    const trail = text.slice(text.trimEnd().length);
    text = text.trim();
    const wrap = (command: string) => {
      formatted = true;
      text = `\\${command}{${text}}`;
    };
    if (sup) wrap("textsuperscript");
    else if (sub) wrap("textsubscript");
    if (underline) wrap("underline");
    if (italic) wrap("textit");
    if (bold) wrap("textbf");
    const href = tag === "A" ? (el.getAttribute("href") ?? "") : "";
    if (/^(?:https?:|mailto:)/i.test(href)) {
      formatted = true;
      packages.add("hyperref");
      // An address is written as it is, but for the characters that would end the argument.
      const address = href.replace(/[%#\\{}]/g, (ch) => `\\${ch}`);
      text = el.textContent?.trim() === href ? `\\url{${address}}` : `\\href{${address}}{${text}}`;
    }
    return lead + text + trail;
  };

  const visit = (node: Node, f: Formats, list: { ordered: boolean; level: number } | null, inItem = false) => {
    if (node.nodeType !== 1) {
      add(inline(node, f, true));
      return;
    }
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIPPED.test(tag)) return;
    if (tag === "UL" || tag === "OL") {
      flush();
      const nested = { ordered: tag === "OL", level: (list?.level ?? 0) + 1 };
      for (const child of el.childNodes) visit(child, f, nested);
      flush();
      return;
    }
    const heading = /^H([1-6])$/.exec(tag);
    const item = tag === "LI" && list ? list : wordListItem(el);
    // A paragraph that opens a list item, as Google Docs and many pages write one, is the item;
    // a later paragraph of the same item stays in it, as a paragraph of its own there.
    if (!heading && !item && BLOCK.test(tag) && current?.item && (!current.text.trim() || inItem)) {
      if (current.text.trim()) add(" \\par ");
      for (const child of el.childNodes) visit(child, f, list, inItem);
      return;
    }
    if (heading || item || BLOCK.test(tag)) {
      flush();
      if (heading) formatted = true;
      if (item) formatted = true;
      current = { text: "", heading: heading ? Number(heading[1]) : undefined, item: item ?? undefined };
      // A heading is set in bold by LaTeX already.
      const inner = heading ? { ...f, bold: true } : f;
      // Lists inside a list item are lists of their own, after the item's text.
      for (const child of el.childNodes) visit(child, inner, item ?? list, !!item);
      flush();
      return;
    }
    // An element around paragraphs, headings or lists keeps them apart.
    if (el.querySelector(BLOCK_SELECTOR)) {
      for (const child of el.childNodes) visit(child, f, list);
      return;
    }
    add(inline(el, f, true));
  };

  for (const child of body.childNodes) visit(child, {}, null);
  flush();
  if (!formatted || !blocks.length) return null;
  return { latex: write(blocks), packages: [...packages] };
}

/** The blocks as LaTeX: paragraphs apart, lists as nested itemize and enumerate. */
function write(blocks: Block[]): string {
  const out: string[] = [];
  const open: { ordered: boolean; level: number }[] = [];
  let lines: string[] = [];
  const indent = () => "  ".repeat(open.length);
  const close = () => {
    const env = open.pop()!;
    lines.push(`${indent()}\\end{${env.ordered ? "enumerate" : "itemize"}}`);
  };
  for (const block of blocks) {
    if (!block.item) {
      while (open.length) close();
      if (lines.length) out.push(lines.join("\n"));
      lines = [];
      out.push(block.heading ? `${COMMANDS[Math.min(block.heading, 4) - 1]}{${block.text}}` : block.text);
      continue;
    }
    // LaTeX nests lists four deep at most.
    const { ordered } = block.item;
    const level = Math.min(block.item.level, 4);
    while (open.length && open[open.length - 1].level > level) close();
    if (open.length && open[open.length - 1].level === level && open[open.length - 1].ordered !== ordered) close();
    if (!open.length || open[open.length - 1].level < level) {
      lines.push(`${indent()}\\begin{${ordered ? "enumerate" : "itemize"}}`);
      open.push({ ordered, level });
    }
    lines.push(`${indent()}\\item ${block.text}`);
  }
  while (open.length) close();
  if (lines.length) out.push(lines.join("\n"));
  return out.join("\n\n");
}
