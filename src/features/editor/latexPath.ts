// Where the cursor is, in LaTeX's terms, for the status line of the page view: the section it is
// in, the environments around it and the commands whose argument it is in, outermost first. A
// word processor's user learns the structure of LaTeX by watching it. Pure.
import { closingBrace, documentStart } from "./visualModel";

const HEADING = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}\n]*)\}/g;
const ENV = /\\(begin|end)\{([^}]+)\}/g;
const LONG = 24;

/** The text with comments blanked out, every offset kept. */
function uncommented(text: string): string {
  return text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
}

export function latexPath(text: string, pos: number): string[] {
  const begin = documentStart(text);
  if (begin >= 0 && pos < begin) return ["preamble"];
  const code = uncommented(text.slice(0, pos));
  const path: string[] = [];

  let heading = "";
  for (const m of code.matchAll(HEADING)) {
    if (m.index + m[0].length > pos) continue;
    const title = m[2].trim();
    heading = `\\${m[1]}{${title.length > LONG ? `${title.slice(0, LONG).trimEnd()}…` : title}}`;
  }
  if (heading) path.push(heading);

  const envs: { name: string; at: number }[] = [];
  for (const m of code.matchAll(ENV)) {
    if (m[1] === "begin") envs.push({ name: m[2], at: m.index + m[0].length });
    else if (envs[envs.length - 1]?.name === m[2]) envs.pop();
  }
  for (const env of envs) {
    if (env.name === "document") continue;
    path.push(env.name);
    if (/^(?:itemize|enumerate|description)$/.test(env.name) && /\\item\b/.test(code.slice(env.at))) path.push("\\item");
  }

  // The commands whose braces the cursor is between, found back to the start of its paragraph.
  const paragraph = Math.max(code.lastIndexOf("\n\n") + 2, envs.length ? envs[envs.length - 1].at : 0, begin < 0 ? 0 : begin);
  const inside: string[] = [];
  for (const m of code.slice(paragraph).matchAll(/\\([a-zA-Z]+)\*?(?:\[[^\]\n]*\])?\{/g)) {
    const open = paragraph + m.index + m[0].length - 1;
    const close = closingBrace(text, open);
    if (close < 0 || close > pos) inside.push(`\\${m[1]}`);
  }
  return [...path, ...inside];
}
