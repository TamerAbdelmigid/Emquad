// Pictures added by dragging them onto the editor or pasting them: where in the project they
// go, and the figure written for each. Pure.

import { relativeTo, resolveFrom } from "../../shared/paths";

/** The kinds of picture LaTeX shows, by extension. */
export const PICTURE = /\.(png|jpe?g|pdf)$/i;

/**
 * The project folder new pictures go in, and how the document names a picture there: the first
 * folder \graphicspath gives, inside the project, where a picture is named by its file name
 * alone; else figures/ beside the main file, named from the main file's folder.
 */
export function pictureFolder(mainText: string, mainFolder: string): { dir: string; byName: boolean } {
  const code = mainText.replace(/(?<!\\)%[^\n]*/g, "");
  const first = /\\graphicspath\s*\{\s*\{([^{}]*)\}/.exec(code)?.[1].trim();
  const dir = first ? resolveFrom(mainFolder, first) : null;
  if (dir !== null && first) return { dir: dir.replace(/\/$/, ""), byName: true };
  return { dir: `${mainFolder}figures`, byName: false };
}

/**
 * A figure for the picture at project path `path`, centred, as wide as most of the line, with a
 * caption to type and a label to refer to it by that no other has. `caret` is where the caption
 * is typed.
 */
export function figureFor(path: string, mainFolder: string, byName: boolean, labels: Iterable<string>): { text: string; caret: number; label: string } {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const named = byName ? file : relativeTo(mainFolder, path);
  const stem = file
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const taken = new Set(labels);
  let label = `fig:${stem || "picture"}`;
  for (let n = 2; taken.has(label); n++) label = `fig:${stem || "picture"}-${n}`;
  const before = `\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${named}}\n  \\caption{`;
  return { text: `${before}}\n  \\label{${label}}\n\\end{figure}\n`, caret: before.length, label };
}
