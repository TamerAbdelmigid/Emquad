import { describe, expect, it } from "vitest";
import { type Reference, appendEntries, entries, formatEntry, makeKey, people } from "./bib";

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
});
