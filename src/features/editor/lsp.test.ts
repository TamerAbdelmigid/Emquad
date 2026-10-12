// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fileUri, sanitize } from "./lsp";

describe("fileUri", () => {
  it("encodes awkward names and keeps the drive letter", () => {
    expect(fileUri("E:\\My Papers\\thesis #2", "sections/intro é.tex")).toBe(
      "file:///E:/My%20Papers/thesis%20%232/sections/intro%20%C3%A9.tex",
    );
    expect(fileUri("C:/a%b", "")).toBe("file:///C:/a%25b");
  });
  it("keeps the server of a network share as the host", () => {
    expect(fileUri("\\\\server\\share\\proj", "main.tex")).toBe("file://server/share/proj/main.tex");
  });
});

describe("sanitize", () => {
  it("keeps formatting and drops anything that loads, runs or navigates", () => {
    const dirty =
      '<p onclick="x()">A <b>label</b> <a href="https://example.com" title="t">link text</a></p>' +
      '<script>alert(1)</script><img src="https://example.com/x.png"><base href="https://example.com/">' +
      '<a href="javascript:alert(1)">js</a><form action="https://example.com"><input></form><code style="color:red">c</code>';
    const clean = sanitize(dirty);
    expect(clean).toBe('<p>A <b>label</b> <a title="t">link text</a></p><a>js</a><code>c</code>');
  });
});
