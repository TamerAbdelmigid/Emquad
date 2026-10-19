import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { applyChanges, enterInEmptyItem, outdentItem, toggleList, indentItem } from "./lists";
import { toggleFormat, setColour, clearFormatting } from "./formatting";
import { setAlignment, setBlockStyle } from "./blocks";
import { toggleCommand } from "./latex";

const DOC = (b: string) => `\\documentclass{article}\n\\usepackage[normalem]{ulem}\\usepackage{xcolor,soul,amsthm}\\newtheorem{theorem}{Theorem}\n\\begin{document}\n${b}\n\\end{document}\n`;
const out: string[] = [];
const log = (name: string, s: unknown) => out.push(`=== ${name}\n${typeof s === "string" ? s : JSON.stringify(s)}`);
function fmt(name: string, t: string, a: string, b: string, cmd = "textbf") {
  const from = t.indexOf(a), to = t.indexOf(b) + b.length;
  const r = toggleFormat(t, from, to, cmd);
  if (!r) {
    log(name + " (restyle null; fallback)", applyChanges(t, toggleCommand(t, from, to, cmd).changes));
    return;
  }
  log(name, applyChanges(t, r.changes));
}

it("probe", () => {
  fmt("figure", DOC("Some text here\n\\begin{figure}\n\\centering\nX\n\\caption{c}\n\\end{figure}\nmore words."), "text here", "more");
  fmt("verb", DOC("Use \\verb|x_y| now."), "Use", "now");
  fmt("theorem", DOC("Intro text\n\\begin{theorem}\nStatement.\n\nMore.\n\\end{theorem}"), "text", "State");
  fmt("hl footnote", DOC("Words\\footnote{note} here."), "Words", "here", "hl");
  fmt("hl cite", DOC("Words \\ref{x} here."), "Words", "here", "hl");
  fmt("sout then hl", DOC("\\sout{Words here}."), "Words", "here", "hl");
  fmt("hl then sout", DOC("\\hl{Words here}."), "Words", "here", "sout");
  fmt("hl over bold", DOC("\\textbf{Words} here."), "Words", "here", "hl");
  fmt("sout over newline", DOC("Words a\\\\ here."), "Words", "here", "sout");
  fmt("verbatim env", DOC("A\n\\begin{verbatim}\nx\n\\end{verbatim}\nB"), "A", "B");
  fmt("lstinline braces", DOC("Use \\verb{x} now."), "Use", "now");
  fmt("colour", DOC("Use x now."), "Use", "now", "textcolor{darkred}");
  const d = DOC("\\begin{description}\n  \\item[Apples] \n  \\item[Pears] are green\n\\end{description}");
  const e = enterInEmptyItem(d, d.indexOf("[Apples]") + 8);
  log("description enter", e ? applyChanges(d, e.changes) : null);
  const bs = outdentItem(d, d.indexOf("[Pears]"), true);
  log("description backspace", bs ? applyChanges(d, bs.changes) : null);
  const sec = DOC("\\section{A very long\n  title}\nText of the section.");
  const al = setAlignment(sec, sec.indexOf("Text"), sec.indexOf("Text"), "center");
  log("align multiline heading", al ? applyChanges(sec, al) : null);
  const q = setBlockStyle(sec, sec.indexOf("Text"), sec.indexOf("Text"), "quote");
  log("quote multiline heading", q ? applyChanges(sec, q) : null);
  const fn = DOC("Text\\footnote{See\n\\begin{itemize}\n\\item x\n\\end{itemize}\n} done.");
  const al2 = setAlignment(fn, fn.indexOf("Text"), fn.indexOf("Text"), "center");
  log("align footnote list", al2 ? applyChanges(fn, al2) : null);
  const tl = toggleList(sec, sec.indexOf("Text"), sec.indexOf("Text"), "itemize");
  log("list multiline heading", tl ? applyChanges(sec, tl.changes) : null);
  const tl2 = toggleList(sec, sec.indexOf("title"), sec.indexOf("title"), "itemize");
  log("list on heading tail", tl2 ? applyChanges(sec, tl2.changes) : null);
  const sub = "\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\n";
  log("no document toggle", toggleList(sub, sub.indexOf("b\n"), sub.indexOf("b\n"), "itemize"));
  const grp = DOC("{\\large Para one\nstill one\n\nPara two}");
  const tl3 = toggleList(grp, grp.indexOf("Para one"), grp.indexOf("Para two"), "itemize");
  log("list across group", tl3 ? applyChanges(grp, tl3.changes) : null);
  const grp2 = DOC("\\textbf{Para one\nstill} one more\n\nPara two");
  const al3 = setAlignment(grp2, grp2.indexOf("one more"), grp2.indexOf("one more"), "center");
  log("align across group", al3 ? applyChanges(grp2, al3) : null);
  const en = DOC("\\begin{enumerate}\n  \\item a\n  \\item \n  \\item c\n\\end{enumerate}");
  const e2 = enterInEmptyItem(en, en.indexOf("\\item \n") + 6);
  log("enum middle", e2 ? applyChanges(en, e2.changes) : null);
  const cm = DOC("\\begin{itemize}\n  \\item a % note\n  \\item b\n\\end{itemize}");
  const ind = indentItem(cm, cm.indexOf("b\n"));
  log("indent", ind ? applyChanges(cm, ind.changes) : null);
  const cl = clearFormatting(DOC("\\textcolor{red}{a \\hl{b} c} d"), DOC("\\textcolor{red}{a \\hl{b} c} d").indexOf("b"), DOC("\\textcolor{red}{a \\hl{b} c} d").indexOf("b") + 1);
  log("clear", cl);
  const sc = DOC("Plain words and more.");
  const s1 = setColour(sc, sc.indexOf("words"), sc.indexOf("more"), "royalblue");
  log("colour", s1 ? applyChanges(sc, s1.changes) : null);
  const crlf = DOC("Word \\% one { two } \\{ x");
  fmt("escaped", crlf, "Word", "x");
  writeFileSync(process.env.PROBE_OUT ?? "probe.txt", out.join("\n"));
});
