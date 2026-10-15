// References as a .bib file holds them: reading its entries, adding new ones without
// duplicating any, making a key for a reference, and writing one from a form. Pure.

/** One entry of a .bib file: its key, its kind ("article", "book" …), and where it is. */
export interface Entry {
  key: string;
  kind: string;
  from: number;
  to: number;
}

/**
 * The entries of BibTeX text, in order, read as BibTeX reads them: every brace counts, a
 * backslash before it or not, and an entry in round brackets ends at the first one outside
 * braces. @comment, @string and @preamble are not references. `unclosed` is the key of an entry
 * that is never closed, which takes in everything after it.
 */
function scan(text: string): { found: Entry[]; unclosed: string | null } {
  const found: Entry[] = [];
  const start = /@\s*([a-zA-Z]+)\s*([{(])\s*([^,\s})]*)/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    const kind = m[1].toLowerCase();
    // BibTeX reads past the word @comment and nothing more: what follows is free text.
    if (kind === "comment") continue;
    const open = m.index + m[0].indexOf(m[2]);
    let braces = 0;
    let quoted = false;
    let to = -1;
    for (let i = open + 1; i < text.length && to < 0; i++) {
      const ch = text[i];
      if (ch === "{") braces++;
      else if (ch === "}") {
        if (braces === 0 && m[2] === "{") to = i + 1;
        else braces = Math.max(0, braces - 1);
      } else if (ch === '"' && braces === 0) quoted = !quoted;
      // A ) inside a value, in braces or quotes, does not close an entry in round brackets.
      else if (ch === ")" && m[2] === "(" && braces === 0 && !quoted) to = i + 1;
    }
    if (to < 0) return { found, unclosed: m[3] || kind };
    // Whatever is inside an entry, an @ in an address too, is part of it.
    start.lastIndex = to;
    const key = m[3];
    if (["string", "preamble"].includes(kind) || !key || !/^\s*,/.test(text.slice(m.index + m[0].length))) continue;
    found.push({ key, kind, from: m.index, to });
  }
  return { found, unclosed: null };
}

/** The entries of BibTeX text, in order. */
export const entries = (text: string): Entry[] => scan(text).found;

/** The key of an entry that is never closed, or null when every entry is. */
export const unclosedEntry = (text: string): string | null => scan(text).unclosed;

/**
 * `existing` with the entries of `incoming` added at its end, each one whose key is not there
 * already (BibTeX takes Knuth1984 and knuth1984 for the same key): what was added, and the
 * keys left out because the file has them.
 */
export function appendEntries(existing: string, incoming: string): { text: string; added: string[]; kept: string[] } {
  const have = new Set(entries(existing).map((e) => e.key.toLowerCase()));
  const added: string[] = [];
  const kept: string[] = [];
  const pieces: string[] = [];
  for (const e of entries(incoming)) {
    if (have.has(e.key.toLowerCase())) {
      kept.push(e.key);
      continue;
    }
    have.add(e.key.toLowerCase());
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

/**
 * The people of a reference, each as "Surname, Given". An organisation written in braces,
 * "{World Health Organization}", is kept as it is, "and" in it too.
 */
export function people(authors: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= authors.length; i++) {
    const ch = authors[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (i === authors.length || (depth === 0 && (ch === ";" || ch === "\n"))) {
      parts.push(authors.slice(from, i));
      from = i + 1;
    } else if (depth === 0 && /^\sand\s/.test(authors.slice(i, i + 5))) {
      parts.push(authors.slice(from, i));
      from = i + 4;
    }
  }
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p.includes(",") || p.startsWith("{")) return p;
      const words = p.split(/\s+/);
      return words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(" ")}` : p;
    });
}

/** A key for a reference in the usual way, surname and year ("knuth1984"), made unique against `taken`. */
export function makeKey(authors: string, year: string, title: string, taken: Iterable<string>): string {
  // BibTeX takes keys that differ only in case for the same key.
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  // The surname of the first person, or the first word of an organisation's name.
  const first = people(authors)[0] ?? "";
  const surname = first.startsWith("{") ? first.slice(1).split(/[\s}]/)[0] : first.split(",")[0];
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

/**
 * `text` with any brace that has no partner left out. BibTeX counts every brace, one after a
 * backslash too, so one without a partner would make the entry run on through the file.
 */
function balanced(text: string): string {
  const drop = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") open.push(i);
    else if (text[i] === "}" && open.pop() === undefined) drop.add(i);
  }
  for (const i of open) drop.add(i);
  return text
    .split("")
    .filter((_, i) => !drop.has(i))
    .join("");
}

/** A field's value written so that BibTeX prints it as typed: &, %, #, _ and $ escaped, braces balanced. */
const value = (text: string) =>
  balanced(text)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?<!\\)([&%#_$])/g, "\\$1");

/**
 * A reference written as a BibTeX entry under `key`. A web page is written as @misc with its
 * address in \url, which every style prints; @online is biblatex's alone.
 */
export function formatEntry(ref: Reference, key: string): string {
  const url = balanced(ref.url.trim());
  const online = ref.kind === "online";
  const where: [string, string][] = online
    ? [
        ["howpublished", url ? `\\url{${url}}` : value(ref.where)],
        ["note", url ? value(ref.where) : ""],
      ]
    : [[WHERE[ref.kind], value(ref.where)]];
  const fields: [string, string][] = [
    ["author", value(people(ref.authors).join(" and "))],
    // Double braces keep the title's capitals as typed.
    ["title", ref.title.trim() ? `{${value(ref.title)}}` : ""],
    ...where,
    ["year", value(ref.year)],
    ["volume", value(ref.volume)],
    ["pages", value(ref.pages.replace(/\s*[-–—]+\s*/g, "--"))],
    ["doi", balanced(ref.doi.trim())],
    ["url", online ? "" : url],
  ];
  const kept = fields.filter(([, v]) => v.trim());
  const width = Math.max(...kept.map(([name]) => name.length));
  const lines = kept.map(([name, v]) => `  ${name.padEnd(width)} = {${v}},`);
  return `@${online ? "misc" : ref.kind}{${key},\n${lines.join("\n")}\n}\n`;
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
