// Drawing a short piece of LaTeX as it will read: mathematics typeset, bold and italic shown
// as such, the rest as written. Used for table cells.
import katex from "katex";
import "katex/dist/katex.min.css";
import { closingBrace } from "./visualModel";

export function typeset(el: HTMLElement, tex: string, display: boolean) {
  // A formula that cannot be typeset is shown as its source, marked, never as an error box.
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: true, output: "html" });
  } catch {
    el.textContent = tex;
    el.classList.add("cm-v-math-bad");
    el.title = "This formula could not be previewed here. It may still compile.";
  }
}

const INLINE_TAGS = new Map([
  ["textbf", "b"],
  ["textit", "i"],
  ["emph", "i"],
  ["texttt", "code"],
  ["underline", "u"],
  ["textsc", "span"],
  ["textrm", "span"],
  ["mbox", "span"],
]);

/**
 * Draw the text of a table cell: mathematics, bold and italic are shown as such, and the rest
 * as it is written. Everything is added as text or as elements made here, never as markup.
 */
export function renderInline(el: HTMLElement, tex: string) {
  let plain = "";
  const flush = () => {
    if (plain) el.append(plain.replace(/~/g, " ").replace(/\s+/g, " "));
    plain = "";
  };
  for (let i = 0; i < tex.length; ) {
    const c = tex[i];
    if (c === "$") {
      const end = tex.indexOf("$", i + 1);
      if (end > i) {
        flush();
        const span = document.createElement("span");
        span.className = "cm-v-math";
        typeset(span, tex.slice(i + 1, end), false);
        el.append(span);
        i = end + 1;
        continue;
      }
    }
    if (c === "\\") {
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0];
      const tag = name ? INLINE_TAGS.get(name) : undefined;
      if (name && tag && tex[i + 1 + name.length] === "{") {
        const open = i + 1 + name.length;
        const end = closingBrace(tex, open);
        if (end > 0) {
          flush();
          const child = document.createElement(tag);
          renderInline(child, tex.slice(open + 1, end - 1));
          el.append(child);
          i = end;
          continue;
        }
      }
      if (!name && i + 1 < tex.length) {
        // An escaped character such as \& or \% stands for itself.
        plain += tex[i + 1] === "\\" ? " " : tex[i + 1];
        i += 2;
        continue;
      }
    }
    if (c !== "{" && c !== "}") plain += c;
    i++;
  }
  flush();
}
