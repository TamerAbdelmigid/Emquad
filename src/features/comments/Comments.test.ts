import { describe, expect, it } from "vitest";
import type { Comment } from "../../ipc/api";
import { arrange } from "./Comments";

const comment = (id: string, path: string, line: number, resolved = false): Comment => ({
  id,
  path,
  line,
  resolved,
  quote: "q",
  before: "",
  after: "",
  authorId: "a",
  authorName: "A",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  text: "t",
  deleted: false,
  replies: [],
});

describe("arrange", () => {
  const all = [comment("1", "b.tex", 9), comment("2", "main.tex", 30), comment("3", "a.tex", 1), comment("4", "main.tex", 2, true), comment("5", "main.tex", 7)];

  it("lists the open file first, in the order of the passages, then the other files by name", () => {
    expect(arrange(all, "main.tex", true).map((c) => c.id)).toEqual(["4", "5", "2", "3", "1"]);
  });

  it("hides resolved comments unless asked for them", () => {
    expect(arrange(all, "main.tex", false).map((c) => c.id)).toEqual(["5", "2", "3", "1"]);
  });
});
