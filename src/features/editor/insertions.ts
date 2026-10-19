// What Insert puts in, shared by the Insert menu and the ribbon: each with the LaTeX it writes, so
// the ribbon's tooltip can say so.
import { buffers } from "./buffers";

export interface Insertion {
  label: string;
  /** The LaTeX it writes, as a tooltip shows it. */
  tex: string;
  run: () => void;
}

const snippet = (label: string, before: string, after = ""): Insertion => ({
  label,
  tex: `${before}…${after}`.trim(),
  run: () => buffers.insert(before, after),
});

export const INSERT = {
  chapter: snippet("Chapter", "\\chapter{", "}"),
  section: snippet("Section", "\\section{", "}"),
  figure: snippet("Figure", "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{", "}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}\n"),
  equation: snippet("Numbered equation", "\\begin{equation}\n  ", "\n\\end{equation}\n"),
  bullets: snippet("Bulleted list", "\\begin{itemize}\n  \\item ", "\n\\end{itemize}\n"),
  numbers: snippet("Numbered list", "\\begin{enumerate}\n  \\item ", "\n\\end{enumerate}\n"),
  footnote: { label: "Footnote", tex: "\\footnote{…}", run: () => buffers.insertInline(() => ({ before: "\\footnote{", after: "}" })) },
  crossReference: { label: "Cross-reference", tex: "\\ref{…}", run: () => buffers.insertInline(() => ({ before: "\\ref{", after: "}" })) },
  contents: snippet("Table of contents", "\\tableofcontents\n"),
  pageBreak: snippet("Page break", "\\newpage\n"),
  inlineFormula: {
    label: "Formula in the line",
    tex: "$…$",
    run: () => buffers.insertInline((inMath) => (inMath ? { before: "", after: "" } : { before: "$", after: "$" })),
  },
} satisfies Record<string, Insertion>;
