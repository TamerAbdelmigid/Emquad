// @vitest-environment jsdom
// How long visual mode takes per keystroke and per cursor move in a long document (5,000 lines,
// 50 tables, 3,000 references). The limits are generous, to catch a return to redrawing the
// whole document on each one, which took about 50 ms, not to time the machine.
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { store } from "../../state/store";
import { redrawVisual, visualMode } from "./visual";

const r = String.raw;

function makeDoc() {
  const out: string[] = [r`\documentclass{article}`, r`\usepackage{amsmath}`, r`\usepackage{booktabs}`, r`\title{A long paper}`, r`\begin{document}`, r`\maketitle`];
  let t = 0;
  while (out.length < 5000) {
    const i = out.length;
    if (i % 95 === 0 && t < 50) {
      t++;
      out.push(r`\begin{table}[h]`, r`\centering`, r`\begin{tabular}{|l|c|r|r|}`, r`\hline`);
      for (let k = 0; k < 8; k++) out.push(`Row ${k} ` + r`\textbf{x} & $a_{` + k + r`}$ & ` + k * 3.5 + r` & 12\% \\ \hline`);
      out.push(r`\end{tabular}`, r`\caption{Table ` + t + "}", r`\label{tab:` + t + "}", r`\end{table}`);
    } else if (i % 37 === 0) out.push(r`\section{Section ` + i + "}", r`\label{sec:` + i + "}");
    else if (i % 23 === 0) out.push(r`\begin{equation}`, r`  E_{` + i + r`} = mc^2 + \int_0^1 f(x)\,dx`, r`\end{equation}`);
    else if (i % 17 === 0) out.push(r`\begin{itemize}`, r`  \item First point with \emph{emphasis}`, r`  \item Second point \cite{key` + (i % 3000) + "}", r`\end{itemize}`);
    else out.push(`Some prose line ${i} with $x^2 + y_${i}$ inline maths, ` + r`\textbf{bold} \cite{key` + (i % 3000) + "}.");
  }
  out.push(r`\end{document}`);
  return out.join("\n");
}

test("visual mode keeps up with typing and moving in a long document", { timeout: 120000 }, () => {
  const citations = Array.from({ length: 3000 }, (_, i) => ({ key: `key${i}`, authors: `Author${i}`, year: "2020", title: `Title ${i}` }));
  store().set({ index: { labels: [], citeKeys: citations.map((c) => c.key), citations, stylePackages: {}, labelNumbers: {}, documentClass: "" } });
  const doc = makeDoc();
  let state = EditorState.create({ doc, extensions: [visualMode] });
  const prose = doc.indexOf("Some prose line 3001 with");
  state = state.update({ selection: { anchor: prose } }).state;
  const time = (n: number, step: () => void) => {
    step();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step();
    return (performance.now() - t0) / n;
  };
  const typing = time(20, () => {
    const at = state.selection.main.head;
    state = state.update({ changes: { from: at, insert: "a" }, selection: { anchor: at + 1 }, userEvent: "input.type" }).state;
  });
  const redraw = time(5, () => {
    state = state.update({ effects: redrawVisual.of(null) }).state;
  });
  const moving = time(20, () => {
    state = state.update({ selection: { anchor: state.selection.main.head + 1 } }).state;
  });
  expect(typing).toBeLessThan(10);
  expect(moving).toBeLessThan(5);
  // Drawn again once typing pauses: well under the pause itself.
  expect(redraw).toBeLessThan(150);
});
