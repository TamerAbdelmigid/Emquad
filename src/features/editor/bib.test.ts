import { describe, expect, it } from "vitest";
import { type Reference, appendEntries, entries, formatEntry, makeKey, namedBib, people, unclosedEntry } from "./bib";

const BIB = "% my references\n@book{knuth1984,\n  author = {Donald E. Knuth},\n  title = {The {\\TeX}book},\n  year = {1984},\n}\n\n@string{tug = \"TUGboat\"}\n@article(lamport1994, title = {A {nested} title}, year = 1994)\n";

describe("reading a .bib file", () => {
  it("finds each reference with its key, nested braces and round brackets too", () => {
    expect(entries(BIB).map((e) => [e.key, e.kind])).toEqual([
      ["knuth1984", "book"],
      ["lamport1994", "article"],
    ]);
    const [first] = entries(BIB);
    expect(BIB.slice(first.from, first.to).endsWith("year = {1984},\n}")).toBe(true);
  });

  it("reads as BibTeX does: an @ inside an entry is part of it, every brace counts, and one never closed is found", () => {
    expect(entries("@misc{a, note = {me@example{x, y}}}\n@misc{b, title={B}}").map((e) => e.key)).toEqual(["a", "b"]);
    const paren = "@article(k1, title = {1) first}, year = 2000)\n@misc{k2, title={x}}";
    expect(entries(paren).map((e) => [e.key, paren.slice(e.from, e.to).endsWith("2000)") || e.key])).toEqual([
      ["k1", true],
      ["k2", "k2"],
    ]);
    // BibTeX counts the brace after the backslash too: this entry is never closed.
    expect(unclosedEntry("@book{k, title = {a \\} b}}\n")).toBeNull();
    expect(unclosedEntry("@book{k, title = {a \\{ b}}\n@misc{later, title={L}}")).toBe("k");
    expect(unclosedEntry(BIB)).toBeNull();
    // @comment is skipped as a word, its braces not read; a ) in quotes is part of the value.
    expect(unclosedEntry("@comment{ a { b }\n@misc{k, title={K}}")).toBeNull();
    expect(entries('@article(q, title = "a ) b", year = 2000)').map((e) => e.key)).toEqual(["q"]);
    expect(entries('@article(q, title = "a ) b", year = 2000)\n@misc{r, title={R}}').map((e) => e.key)).toEqual(["q", "r"]);
  });
});

describe("adding references", () => {
  it("adds those the file does not have, after a blank line, and says which it had", () => {
    const incoming = "@book{knuth1984, title={again}}\n@misc{new2020,\n  title = {New},\n}";
    const out = appendEntries(BIB, incoming);
    expect(out.added).toEqual(["new2020"]);
    expect(out.kept).toEqual(["knuth1984"]);
    expect(out.text).toBe(`${BIB}\n@misc{new2020,\n  title = {New},\n}\n`);
    expect(appendEntries("", incoming).text).toBe("@book{knuth1984, title={again}}\n\n@misc{new2020,\n  title = {New},\n}\n");
  });

  it("takes keys that differ only in case for the same, as BibTeX does", () => {
    expect(appendEntries(BIB, "@book{Knuth1984, title={again}}").added).toEqual([]);
    expect(makeKey("Ada Lovelace", "1843", "", ["Lovelace1843"])).toBe("lovelace1843a");
  });
});

describe("making a reference from a form", () => {
  const ref: Reference = {
    kind: "article",
    authors: "Ada Lovelace; Babbage, Charles",
    title: "Notes on the Analytical Engine & more",
    year: "1843",
    where: "Taylor's Scientific Memoirs",
    volume: "3",
    pages: "666 - 731",
    doi: "",
    url: "https://example.org/a_b",
  };

  it("names people surname first, and makes a key from the first surname and the year", () => {
    expect(people(ref.authors)).toEqual(["Lovelace, Ada", "Babbage, Charles"]);
    expect(people("Alan Turing and John von Neumann")).toEqual(["Turing, Alan", "Neumann, John von"]);
    expect(makeKey(ref.authors, ref.year, ref.title, [])).toBe("lovelace1843");
    expect(makeKey(ref.authors, ref.year, ref.title, ["lovelace1843"])).toBe("lovelace1843a");
    expect(makeKey("Gödel, Kurt", "1931", "", [])).toBe("godel1931");
    expect(makeKey("", "2020", "The Anatomy of Melancholy", [])).toBe("anatomy2020");
  });

  it("writes it as BibTeX that prints as it was typed", () => {
    expect(formatEntry(ref, "lovelace1843")).toBe(
      "@article{lovelace1843,\n" +
        "  author  = {Lovelace, Ada and Babbage, Charles},\n" +
        "  title   = {{Notes on the Analytical Engine \\& more}},\n" +
        "  journal = {Taylor's Scientific Memoirs},\n" +
        "  year    = {1843},\n" +
        "  volume  = {3},\n" +
        "  pages   = {666--731},\n" +
        "  url     = {https://example.org/a_b},\n" +
        "}\n",
    );
    expect(entries(formatEntry(ref, "k")).map((e) => e.key)).toEqual(["k"]);
  });

  it("never writes a brace without its partner, which would swallow the rest of the file", () => {
    const odd = formatEntry({ ...ref, title: "a { b", url: "http://x.org/a{", authors: "Ada } Lovelace" }, "odd");
    expect(odd).toContain("title   = {{a b}},");
    expect(odd).toContain("url     = {http://x.org/a},");
    expect(odd).toContain("author  = {Lovelace, Ada},");
    expect(unclosedEntry(`${odd}@misc{after, title={A}}`)).toBeNull();
    expect(entries(`${odd}@misc{after, title={A}}`).map((e) => e.key)).toEqual(["odd", "after"]);
  });

  it("keeps an organisation in braces as it is, and writes a web page so that every style prints its address", () => {
    expect(people("{World Health Organization} and Ada Lovelace")).toEqual(["{World Health Organization}", "Lovelace, Ada"]);
    expect(people("{Johnson and Johnson}")).toEqual(["{Johnson and Johnson}"]);
    expect(makeKey("{World Health Organization}", "2020", "", [])).toBe("world2020");
    const page = formatEntry({ ...ref, kind: "online", authors: "{World Health Organization}", title: "Fact sheet", where: "WHO", url: "https://who.int/x" }, "who");
    expect(page).toBe(
      "@misc{who,\n" +
        "  author       = {{World Health Organization}},\n" +
        "  title        = {{Fact sheet}},\n" +
        "  howpublished = {\\url{https://who.int/x}},\n" +
        "  note         = {WHO},\n" +
        "  year         = {1843},\n" +
        "  volume       = {3},\n" +
        "  pages        = {666--731},\n" +
        "}\n",
    );
  });
});

describe("the .bib file a document names", () => {
  it("reads it from \\bibliography or \\addbibresource, and not from a comment", () => {
    expect(namedBib("\\bibliography{refs,more}")).toBe("refs.bib");
    expect(namedBib("\\addbibresource[datatype=bibtex]{lib/refs.bib}")).toBe("lib/refs.bib");
    expect(namedBib("% \\bibliography{old}\n\\bibliography{new.bib}")).toBe("new.bib");
    expect(namedBib("No list of references")).toBeNull();
  });
});
