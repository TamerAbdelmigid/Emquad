// Pictures and tables as the Picture tab and the Position menu see them: a figure or table
// environment, which LaTeX places where it fits best (a float), and the width of the picture in
// it as a share of the line. Pure: each function reads the text and gives the changes to make.
import { type Env, environments, uncommented } from "./blocks";
import type { TextChange } from "./formatting";

export interface FloatHere {
  kind: "figure" | "table";
  env: Env;
  /** What is in the brackets after \begin, such as "htbp"; "" when there are none. */
  placement: string;
  /** Just past the \begin and its brackets, a space before them included. */
  head: number;
  /** The picture's width as a share of the line, when it is written so; null otherwise. */
  width: number | null;
  /** How many pictures the environment holds. */
  pictures: number;
}

const FLOATS = /^(figure|table)\*?$/;
const PICTURE = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{/g;
/** A width written as a share of the line. */
const SHARE = /^width\s*=\s*([\d.]*)\s*\\(?:linewidth|textwidth|columnwidth)$/;

/** The innermost figure or table around `at`, the \begin and \end included. */
export function floatAt(text: string, at: number): FloatHere | null {
  let env: Env | null = null;
  for (const e of environments(text)) if (FLOATS.test(e.name) && e.begin <= at && at <= e.tail && (!env || e.begin >= env.begin)) env = e;
  if (!env) return null;
  // Brackets after a space are the placement too, as LaTeX reads them.
  const spaced = env.options ? null : /^[ \t]*\[([^\]\n]*)\]/.exec(text.slice(env.head, env.head + 300));
  // Pictures in comments are not counted.
  const body = uncommented(text).slice(env.head, env.end);
  const pictures = [...body.matchAll(PICTURE)];
  const width = pictures.length === 1 ? (pictures[0][1] ?? "").split(",").map((o) => SHARE.exec(o.trim())).find(Boolean) : null;
  return {
    kind: FLOATS.exec(env.name)![1] as FloatHere["kind"],
    env,
    placement: (spaced ? spaced[1] : env.options).trim(),
    head: env.head + (spaced ? spaced[0].length : 0),
    width: width ? (width[1] === "" ? 1 : Number(width[1])) : null,
    pictures: pictures.length,
  };
}

/**
 * Ask LaTeX to place the figure or table at `at` as `placement` says: "htbp" where it fits
 * best, "h" here if it fits, "t" at the top of a page, "p" on a page of its own, "H" exactly
 * here, which needs the float package.
 */
export function setPlacement(text: string, at: number, placement: string): { changes: TextChange[]; needs: string[] } | null {
  const found = floatAt(text, at);
  if (!found) return null;
  const { env, head } = found;
  const name = /^\\begin\s*\{[^}]*\}/.exec(text.slice(env.begin, head))![0];
  return { changes: [{ from: env.begin, to: head, insert: `${name}[${placement}]` }], needs: placement.includes("H") ? ["float"] : [] };
}

/**
 * Make the picture in the figure at `at` `share` of the line wide, written as a share of
 * \linewidth so that it stays right when the margins change. Its other sizes go. Null where
 * there is not exactly one picture.
 */
export function setPictureWidth(text: string, at: number, share: number): TextChange[] | null {
  const found = floatAt(text, at);
  if (!found || found.pictures !== 1) return null;
  const body = uncommented(text).slice(found.env.head, found.env.end);
  const m = [...body.matchAll(PICTURE)][0];
  const from = found.env.head + m.index;
  const to = from + m[0].length;
  const width = `width=${share === 1 ? "" : String(share)}\\linewidth`;
  const kept = (m[1] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o && !/^(?:width|height|totalheight|scale)\s*=/.test(o));
  return [{ from, to, insert: `\\includegraphics[${[...kept, width].join(", ")}]{` }];
}
