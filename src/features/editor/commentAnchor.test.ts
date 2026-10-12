import { describe as group, expect, it } from "vitest";
import { describe, locate } from "./commentAnchor";

const TEXT = "First line.\nThe quick brown fox jumps.\nA second fox appears here.\n";

group("comment anchors", () => {
  it("remember the words, their surroundings and the line", () => {
    const from = TEXT.indexOf("brown fox");
    const anchor = describe(TEXT, from, from + 9);
    expect(anchor.quote).toBe("brown fox");
    expect(anchor.line).toBe(2);
    expect(anchor.before.endsWith("The quick ")).toBe(true);
    expect(anchor.after.startsWith(" jumps.")).toBe(true);
  });

  it("find the passage again after text is added before it", () => {
    const from = TEXT.indexOf("brown fox");
    const anchor = describe(TEXT, from, from + 9);
    const edited = `A new opening paragraph.\n\n${TEXT}`;
    const at = locate(edited, anchor)!;
    expect(edited.slice(at.from, at.to)).toBe("brown fox");
  });

  it("tell two identical passages apart by what surrounds them", () => {
    const second = TEXT.lastIndexOf("fox");
    const anchor = describe(TEXT, second, second + 3);
    expect(locate(TEXT, anchor)).toEqual({ from: second, to: second + 3 });
    const first = TEXT.indexOf("fox");
    expect(locate(TEXT, describe(TEXT, first, first + 3))).toEqual({ from: first, to: first + 3 });
  });

  it("fall back on the nearest line when the surroundings no longer help", () => {
    const text = "word\n\n\n\n\n\n\n\nword\n";
    expect(locate(text, { quote: "word", before: "zzz", after: "zzz", line: 9 })).toEqual({ from: 12, to: 16 });
    expect(locate(text, { quote: "word", before: "zzz", after: "zzz", line: 1 })).toEqual({ from: 0, to: 4 });
  });

  it("report a passage whose words are gone", () => {
    expect(locate(TEXT, { quote: "purple fox", before: "", after: "", line: 2 })).toBeNull();
    expect(locate(TEXT, { quote: "", before: "", after: "", line: 1 })).toBeNull();
  });
});
