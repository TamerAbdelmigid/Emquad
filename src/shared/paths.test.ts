import { describe, expect, it } from "vitest";
import { relativeTo, resolveFrom } from "./paths";

describe("relativeTo", () => {
  it("writes a project path as LaTeX finds it from the main file's folder", () => {
    expect(relativeTo("", "references.bib")).toBe("references.bib");
    expect(relativeTo("src/", "src/references.bib")).toBe("references.bib");
    expect(relativeTo("src/", "references.bib")).toBe("../references.bib");
    expect(relativeTo("src/thesis/", "src/bib/refs.bib")).toBe("../bib/refs.bib");
    expect(relativeTo("", "bib/refs.bib")).toBe("bib/refs.bib");
  });
});

describe("resolveFrom", () => {
  it("reads a path written in a file as a project path, and never one outside the project", () => {
    expect(resolveFrom("src/", "../refs.bib")).toBe("refs.bib");
    expect(resolveFrom("", "./bib/refs.bib")).toBe("bib/refs.bib");
    expect(resolveFrom("", "../shared.bib")).toBeNull();
    expect(resolveFrom("", "C:/Users/me/shared.bib")).toBeNull();
  });
});
