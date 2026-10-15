// References as a .bib file holds them: reading its entries, adding new ones without
// duplicating any, making a key for a reference, and writing one from a form. Pure.

/** One entry of a .bib file: its key, its kind ("article", "book" …), and where it is. */
export interface Entry {
  key: string;
  kind: string;
  from: number;
  to: number;
}

/** The entries of BibTeX text, in order. @comment, @string and @preamble are not references. */
export function entries(text: string): Entry[] {
  const out: Entry[] = [];
  for (const m of text.matchAll(/@\s*([a-zA-Z]+)\s*([{(])\s*([^,\s})]*)\s*,/g)) {
    const kind = m[1].toLowerCase();
    // The entry runs to the bracket that closes the one it opened with.
    const open = m.index + m[0].indexOf(m[2]);
    const close = m[2] === "{" ? "}" : ")";
    let depth = 0;
    let to = -1;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") i++;
      else if (ch === m[2] || (m[2] === "(" && ch === "{")) depth++;
      else if (ch === close || (m[2] === "(" && ch === "}")) {
        if (--depth === 0) {
          to = i + 1;
          break;
        }
      }
    }
    if (to < 0 || ["comment", "string", "preamble"].includes(kind) || !m[3]) continue;
    out.push({ key: m[3], kind, from: m.index, to });
  }
  return out;
}

/**
 * `existing` with the entries of `incoming` added at its end, each one whose key is not there
 * already: what was added, and the keys left out because the file has them.
 */
export function appendEntries(existing: string, incoming: string): { text: string; added: string[]; kept: string[] } {
  const have = new Set(entries(existing).map((e) => e.key));
  const added: string[] = [];
  const kept: string[] = [];
  const pieces: string[] = [];
  for (const e of entries(incoming)) {
    if (have.has(e.key)) {
      kept.push(e.key);
      continue;
    }
    have.add(e.key);
    added.push(e.key);
    pieces.push(incoming.slice(e.from, e.to).trim());
  }
  if (!pieces.length) return { text: existing, added, kept };
  const nl = existing.includes("\r\n") ? "\r\n" : "\n";
  const lead = existing.trim() === "" ? "" : existing.endsWith(nl + nl) ? "" : existing.endsWith(nl) ? nl : nl + nl;
  return { text: existing + lead + pieces.map((p) => p.replace(/\r?\n/g, nl)).join(nl + nl) + nl, added, kept };
}

/** A reference as the Add reference form holds it. */
export interface Reference {
  kind: "article" | "book" | "inproceedings" | "phdthesis" | "mastersthesis" | "online" | "misc";
  /** One person per line, or separated by ";": "Knuth, Donald" or "Donald Knuth". */
  authors: string;
  title: string;
  year: string;
  /** The journal of an article, the conference of a paper, the publisher of a book, the university of a thesis. */
  where: string;
  volume: string;
  pages: string;
  doi: string;
  url: string;
}

/** The field each kind of reference keeps `where` in. */
const WHERE: Record<Reference["kind"], string> = {
  article: "journal",
  book: "publisher",
  inproceedings: "booktitle",
  phdthesis: "school",
  mastersthesis: "school",
  online: "organization",
  misc: "howpublished",
};

/** The people of a reference, each as "Surname, Given". */
export function people(authors: string): string[] {
  return authors
    .split(/\s*(?:;|\n|\band\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p.includes(",")) return p;
      const words = p.split(/\s+/);
      return words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(" ")}` : p;
    });
}

/** A key for a reference in the usual way, surname and year ("knuth1984"), made unique against `taken`. */
export function makeKey(authors: string, year: string, title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const surname = (people(authors)[0] ?? "").split(",")[0];
  const word = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const firstWord = title.split(/\s+/).map(word).find((w) => w.length > 3 && !["the", "this", "with", "from"].includes(w)) ?? "";
  const base = `${word(surname) || firstWord || "ref"}${word(year)}`;
  if (!used.has(base)) return base;
  for (let i = 0; i < 26; i++) {
    const key = `${base}${String.fromCharCode(97 + i)}`;
    if (!used.has(key)) return key;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A field's value written so that BibTeX prints it as typed: &, %, #, _ and $ escaped, braces balanced. */
function value(text: string): string {
  const escaped = text.replace(/\s+/g, " ").trim().replace(/(?<!\\)([&%#_$])/g, "\\$1");
  let depth = 0;
  for (const ch of escaped.replace(/\\[{}]/g, "")) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return escaped.replace(/(?<!\\)([{}])/g, "\\$1");
  }
  return depth === 0 ? escaped : escaped.replace(/(?<!\\)([{}])/g, "\\$1");
}

/** A reference written as a BibTeX entry under `key`. */
export function formatEntry(ref: Reference, key: string): string {
  const fields: [string, string][] = [
    ["author", people(ref.authors).join(" and ")],
    // Double braces keep the title's capitals as typed.
    ["title", ref.title.trim() ? `{${value(ref.title)}}` : ""],
    [WHERE[ref.kind], ref.where],
    ["year", ref.year],
    ["volume", ref.volume],
    ["pages", ref.pages.replace(/\s*[-–—]+\s*/g, "--")],
    ["doi", ref.doi],
    ["url", ref.url],
  ];
  const width = Math.max(...fields.map(([name]) => name.length));
  const lines = fields
    .filter(([, v]) => v.trim())
    .map(([name, v]) => `  ${name.padEnd(width)} = {${name === "title" || name === "url" || name === "doi" ? v.trim() : value(v)}},`);
  return `@${ref.kind}{${key},\n${lines.join("\n")}\n}\n`;
}

/**
 * The first .bib file a document names, as written (with ".bib" added where \bibliography
 * leaves it out), or null when it names none.
 */
export function namedBib(text: string): string | null {
  const code = text.replace(/(?<!\\)%[^\n]*/g, "");
  const resource = /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(code)?.[1].trim();
  if (resource) return resource;
  const first = /\\bibliography\s*\{([^}]+)\}/.exec(code)?.[1].split(",")[0].trim();
  if (!first) return null;
  return first.toLowerCase().endsWith(".bib") ? first : `${first}.bib`;
}
