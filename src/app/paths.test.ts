import { describe, expect, it } from "vitest";
import { relativeTo } from "./paths";

describe("relativeTo", () => {
  it("writes a project path as LaTeX finds it from the main file's folder", () => {
    expect(relativeTo("", "references.bib")).toBe("references.bib");
    expect(relativeTo("src/", "src/references.bib")).toBe("references.bib");
    expect(relativeTo("src/", "references.bib")).toBe("../references.bib");
    expect(relativeTo("src/thesis/", "src/bib/refs.bib")).toBe("../bib/refs.bib");
    expect(relativeTo("", "bib/refs.bib")).toBe("bib/refs.bib");
  });
});
