import { describe, expect, it } from "vitest";
import { loadSpelling, misspelled, suggestions } from "./spell";

describe("the spelling checker", () => {
  it("knows nothing until a language is chosen", () => {
    expect(misspelled("teh")).toBe(false);
  });

  it("judges words against the bundled dictionary and the user's own words", async () => {
    await loadSpelling("en-US", ["Emquad"], () => {});
    expect(misspelled("the")).toBe(false);
    expect(misspelled("The")).toBe(false);
    expect(misspelled("teh")).toBe(true);
    expect(misspelled("theorem")).toBe(false);
    expect(misspelled("author's")).toBe(false);
    expect(misspelled("don’t")).toBe(false);
    expect(misspelled("Emquad")).toBe(false);
    expect(misspelled("NASA")).toBe(false);
    expect((await suggestions("teh"))[0]).toBe("the");
    expect((await suggestions("recieve"))[0]).toBe("receive");
    expect(misspelled("colour")).toBe(true);
  });

  it("forgets a word taken out of the user's own", async () => {
    await loadSpelling("en-US", ["Emquad"], () => {});
    expect(misspelled("Emquad")).toBe(false);
    await loadSpelling("en-US", [], () => {});
    expect(misspelled("Emquad")).toBe(true);
  });

  it("switches language, and switches off", async () => {
    await loadSpelling("en-GB", [], () => {});
    expect(misspelled("colour")).toBe(false);
    expect(misspelled("teh")).toBe(true);
    await loadSpelling("off", [], () => {});
    expect(misspelled("teh")).toBe(false);
  });
});
