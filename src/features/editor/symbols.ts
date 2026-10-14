// The symbols, accents and structures the Symbol picker offers, and how each is written into
// the source. Pure: no editor, no DOM.
//
// A symbol has the LaTeX it is written as inside a formula, in running text, or both. Where it
// goes decides which is used: a formula symbol typed in text is put in $…$, and a text symbol
// typed in a formula is put in \mbox{…}, so whatever is chosen compiles where it lands.

export interface Sym {
  /** Shown on the tile when there is no formula to typeset, and searched for. */
  glyph: string;
  name: string;
  /** Written inside a formula. */
  math?: string;
  /** Written in running text. */
  text?: string;
  /** A structure or accent: written around the selected text, inside a formula. */
  wrap?: [string, string];
  /** A pair written around the selected text, in running text. */
  textWrap?: [string, string];
  /** What the tile typesets, when it is not `math`. */
  preview?: string;
  /** The package it needs. */
  pkg?: "amssymb" | "amsmath";
  /** Other words it can be found by. */
  words?: string;
}

export interface Category {
  id: string;
  label: string;
  symbols: Sym[];
}

/** The one name of a symbol, used to remember the ones used lately. */
export const symbolId = (s: Sym) => s.math ?? s.text ?? s.wrap?.join("…") ?? s.textWrap?.join("…") ?? s.name;

const m = (glyph: string, math: string, name: string, more: Partial<Sym> = {}): Sym => ({ glyph, math, name, ...more });
const both = (glyph: string, math: string, text: string, name: string, more: Partial<Sym> = {}): Sym => ({ glyph, math, text, name, ...more });
const t = (glyph: string, text: string, name: string, more: Partial<Sym> = {}): Sym => ({ glyph, text, name, ...more });
const s = (preview: string, before: string, after: string, name: string, more: Partial<Sym> = {}): Sym => ({ glyph: "", preview, wrap: [before, after], name, ...more });
const AMS = { pkg: "amssymb" } as const;
const AMSMATH = { pkg: "amsmath" } as const;

export const CATEGORIES: Category[] = [
  {
    id: "greek",
    label: "Greek",
    symbols: [
      m("α", "\\alpha", "alpha"), m("β", "\\beta", "beta"), m("γ", "\\gamma", "gamma"), m("δ", "\\delta", "delta"),
      m("ϵ", "\\epsilon", "epsilon"), m("ε", "\\varepsilon", "epsilon, curly"), m("ζ", "\\zeta", "zeta"), m("η", "\\eta", "eta"),
      m("θ", "\\theta", "theta"), m("ϑ", "\\vartheta", "theta, curly"), m("ι", "\\iota", "iota"), m("κ", "\\kappa", "kappa"),
      m("λ", "\\lambda", "lambda"), both("μ", "\\mu", "\\textmu", "mu", { words: "micro" }), m("ν", "\\nu", "nu"), m("ξ", "\\xi", "xi"),
      m("π", "\\pi", "pi"), m("ϖ", "\\varpi", "pi, variant"), m("ρ", "\\rho", "rho"), m("ϱ", "\\varrho", "rho, curly"),
      m("σ", "\\sigma", "sigma"), m("ς", "\\varsigma", "sigma, final"), m("τ", "\\tau", "tau"), m("υ", "\\upsilon", "upsilon"),
      m("ϕ", "\\phi", "phi"), m("φ", "\\varphi", "phi, curly"), m("χ", "\\chi", "chi"), m("ψ", "\\psi", "psi"), m("ω", "\\omega", "omega"),
      m("Γ", "\\Gamma", "Gamma, capital"), m("Δ", "\\Delta", "Delta, capital"), m("Θ", "\\Theta", "Theta, capital"), m("Λ", "\\Lambda", "Lambda, capital"),
      m("Ξ", "\\Xi", "Xi, capital"), m("Π", "\\Pi", "Pi, capital"), m("Σ", "\\Sigma", "Sigma, capital"), m("Υ", "\\Upsilon", "Upsilon, capital"),
      m("Φ", "\\Phi", "Phi, capital"), m("Ψ", "\\Psi", "Psi, capital"), both("Ω", "\\Omega", "\\textohm", "Omega, capital", { words: "ohm" }),
    ],
  },
  {
    id: "operators",
    label: "Operators",
    symbols: [
      both("×", "\\times", "\\texttimes", "times", { words: "multiply cross" }), both("÷", "\\div", "\\textdiv", "divided by"),
      both("±", "\\pm", "\\textpm", "plus or minus"), m("∓", "\\mp", "minus or plus"), m("·", "\\cdot", "centred dot", { words: "multiply dot product" }),
      m("∘", "\\circ", "ring, compose"), m("∗", "\\ast", "asterisk"), m("⋆", "\\star", "star"), both("•", "\\bullet", "\\textbullet", "bullet"),
      m("⊕", "\\oplus", "circled plus", { words: "xor direct sum" }), m("⊖", "\\ominus", "circled minus"), m("⊗", "\\otimes", "circled times", { words: "tensor" }),
      m("⊙", "\\odot", "circled dot"), m("⊘", "\\oslash", "circled slash"), m("∩", "\\cap", "intersection"), m("∪", "\\cup", "union"),
      m("⊓", "\\sqcap", "square cap"), m("⊔", "\\sqcup", "square cup"), m("∖", "\\setminus", "set minus", { words: "difference" }),
      both("†", "\\dagger", "\\dag", "dagger"), both("‡", "\\ddagger", "\\ddag", "double dagger"), m("⨿", "\\amalg", "amalgamation"), m("≀", "\\wr", "wreath"),
    ],
  },
  {
    id: "relations",
    label: "Relations",
    symbols: [
      m("≠", "\\neq", "not equal"), m("≤", "\\leq", "less or equal"), m("≥", "\\geq", "greater or equal"),
      m("⩽", "\\leqslant", "less or equal, slanted", AMS), m("⩾", "\\geqslant", "greater or equal, slanted", AMS),
      m("≪", "\\ll", "much less"), m("≫", "\\gg", "much greater"), m("≈", "\\approx", "approximately"), m("≃", "\\simeq", "similar or equal"),
      m("≅", "\\cong", "congruent"), m("≡", "\\equiv", "equivalent, identical"), m("∼", "\\sim", "similar, tilde"), m("≐", "\\doteq", "approaches the limit"),
      m("≜", "\\triangleq", "defined as", AMS), m("∝", "\\propto", "proportional to"), m("≲", "\\lesssim", "less or about", AMS),
      m("≳", "\\gtrsim", "greater or about", AMS), m("≺", "\\prec", "precedes"), m("≻", "\\succ", "succeeds"), m("⪯", "\\preceq", "precedes or equal"),
      m("⪰", "\\succeq", "succeeds or equal"), m("∈", "\\in", "element of", { words: "in member" }), m("∉", "\\notin", "not an element of"),
      m("∋", "\\ni", "contains as member"), m("⊂", "\\subset", "subset"), m("⊃", "\\supset", "superset"), m("⊆", "\\subseteq", "subset or equal"),
      m("⊇", "\\supseteq", "superset or equal"), m("⊊", "\\subsetneq", "proper subset", AMS), m("∣", "\\mid", "divides, such that"),
      m("∤", "\\nmid", "does not divide", AMS), m("∥", "\\parallel", "parallel"), m("⊥", "\\perp", "perpendicular"),
      m("⊢", "\\vdash", "proves"), m("⊨", "\\models", "models, entails"), m("≍", "\\asymp", "asymptotic"), m("⋈", "\\bowtie", "join"),
    ],
  },
  {
    id: "arrows",
    label: "Arrows",
    symbols: [
      both("→", "\\rightarrow", "\\textrightarrow", "right arrow", { words: "to" }), both("←", "\\leftarrow", "\\textleftarrow", "left arrow", { words: "gets" }),
      m("↔", "\\leftrightarrow", "left-right arrow"), both("↑", "\\uparrow", "\\textuparrow", "up arrow"), both("↓", "\\downarrow", "\\textdownarrow", "down arrow"),
      m("↕", "\\updownarrow", "up-down arrow"), m("⇒", "\\Rightarrow", "double right arrow", { words: "implies" }), m("⇐", "\\Leftarrow", "double left arrow"),
      m("⇔", "\\Leftrightarrow", "double left-right arrow", { words: "iff equivalent" }), m("⇑", "\\Uparrow", "double up arrow"), m("⇓", "\\Downarrow", "double down arrow"),
      m("⟶", "\\longrightarrow", "long right arrow"), m("⟵", "\\longleftarrow", "long left arrow"), m("⟹", "\\implies", "implies", AMSMATH),
      m("⟸", "\\impliedby", "is implied by", AMSMATH), m("⟺", "\\iff", "if and only if"), m("↦", "\\mapsto", "maps to"), m("⟼", "\\longmapsto", "long maps to"),
      m("↪", "\\hookrightarrow", "hook right arrow", { words: "injection embedding" }), m("↩", "\\hookleftarrow", "hook left arrow"),
      m("↠", "\\twoheadrightarrow", "two-headed right arrow", { ...AMS, words: "surjection onto" }), m("↗", "\\nearrow", "north-east arrow"),
      m("↘", "\\searrow", "south-east arrow"), m("↙", "\\swarrow", "south-west arrow"), m("↖", "\\nwarrow", "north-west arrow"),
      m("⇀", "\\rightharpoonup", "right harpoon"), m("⇌", "\\rightleftharpoons", "equilibrium", { words: "harpoons reversible" }),
      m("↺", "\\circlearrowleft", "circle arrow", AMS), m("⇝", "\\leadsto", "leads to", AMS),
    ],
  },
  {
    id: "logic",
    label: "Sets & logic",
    symbols: [
      m("∀", "\\forall", "for all"), m("∃", "\\exists", "there exists"), m("∄", "\\nexists", "there does not exist", AMS),
      both("¬", "\\neg", "\\textlnot", "not", { words: "negation" }), m("∧", "\\wedge", "and", { words: "wedge conjunction" }),
      m("∨", "\\vee", "or", { words: "vee disjunction" }), m("∅", "\\emptyset", "empty set"), m("⌀", "\\varnothing", "empty set, round", AMS),
      m("ℕ", "\\mathbb{N}", "natural numbers", AMS), m("ℤ", "\\mathbb{Z}", "integers", AMS), m("ℚ", "\\mathbb{Q}", "rational numbers", AMS),
      m("ℝ", "\\mathbb{R}", "real numbers", AMS), m("ℂ", "\\mathbb{C}", "complex numbers", AMS), m("∴", "\\therefore", "therefore", AMS),
      m("∵", "\\because", "because", AMS), m("⊤", "\\top", "true, top"), m("⊥", "\\bot", "false, bottom"), m("ℵ", "\\aleph", "aleph"),
      m("∁", "\\complement", "complement", AMS), m("𝒫", "\\mathcal{P}", "power set"),
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    symbols: [
      m("∑", "\\sum", "sum"), m("∏", "\\prod", "product"), m("∐", "\\coprod", "coproduct"), m("∫", "\\int", "integral"),
      m("∬", "\\iint", "double integral", AMSMATH), m("∭", "\\iiint", "triple integral", AMSMATH), m("∮", "\\oint", "contour integral"),
      m("⋂", "\\bigcap", "big intersection"), m("⋃", "\\bigcup", "big union"), m("⨁", "\\bigoplus", "big circled plus"),
      m("⨂", "\\bigotimes", "big circled times"), m("⋀", "\\bigwedge", "big and"), m("⋁", "\\bigvee", "big or"),
      m("∂", "\\partial", "partial derivative"), m("∇", "\\nabla", "nabla, gradient"), m("∞", "\\infty", "infinity"), m("′", "\\prime", "prime"),
      m("lim", "\\lim", "limit"), m("sin", "\\sin", "sine"), m("cos", "\\cos", "cosine"), m("tan", "\\tan", "tangent"),
      m("log", "\\log", "logarithm"), m("ln", "\\ln", "natural logarithm"), m("exp", "\\exp", "exponential"), m("max", "\\max", "maximum"),
      m("min", "\\min", "minimum"), m("det", "\\det", "determinant"),
    ],
  },
  {
    id: "misc",
    label: "Other",
    symbols: [
      both("…", "\\ldots", "\\ldots", "ellipsis", { words: "dots" }), m("⋯", "\\cdots", "centred dots"), m("⋮", "\\vdots", "vertical dots"),
      m("⋱", "\\ddots", "diagonal dots"), both("°", "^{\\circ}", "\\textdegree", "degree"), m("ℏ", "\\hbar", "h-bar, reduced Planck"),
      m("ℓ", "\\ell", "script l"), m("℘", "\\wp", "Weierstrass p"), m("ℜ", "\\Re", "real part"), m("ℑ", "\\Im", "imaginary part"),
      m("∠", "\\angle", "angle"), m("△", "\\triangle", "triangle"), m("□", "\\square", "square", AMS), m("■", "\\blacksquare", "black square, end of proof", AMS),
      m("◇", "\\Diamond", "diamond", AMS), m("✓", "\\checkmark", "check mark, tick", AMS), m("★", "\\bigstar", "black star", AMS),
      m("♠", "\\spadesuit", "spade"), m("♣", "\\clubsuit", "club"), m("♥", "\\heartsuit", "heart"), m("♦", "\\diamondsuit", "diamond suit"),
      m("♭", "\\flat", "flat"), m("♮", "\\natural", "natural"), m("♯", "\\sharp", "sharp"), m("⌊", "\\lfloor", "left floor"), m("⌋", "\\rfloor", "right floor"),
      m("⌈", "\\lceil", "left ceiling"), m("⌉", "\\rceil", "right ceiling"), m("⟨", "\\langle", "left angle bracket"), m("⟩", "\\rangle", "right angle bracket"),
      m("‖", "\\|", "double bar, norm"),
    ],
  },
  {
    id: "accents",
    label: "Accents & fonts",
    symbols: [
      s("\\hat{a}", "\\hat{", "}", "hat"), s("\\bar{a}", "\\bar{", "}", "bar", { words: "macron mean" }), s("\\tilde{a}", "\\tilde{", "}", "tilde"),
      s("\\dot{a}", "\\dot{", "}", "dot, time derivative"), s("\\ddot{a}", "\\ddot{", "}", "double dot"), s("\\vec{a}", "\\vec{", "}", "vector arrow"),
      s("\\widehat{ab}", "\\widehat{", "}", "wide hat"), s("\\widetilde{ab}", "\\widetilde{", "}", "wide tilde"), s("\\overline{ab}", "\\overline{", "}", "line over", { words: "conjugate" }),
      s("\\underline{ab}", "\\underline{", "}", "line under"), s("\\overrightarrow{AB}", "\\overrightarrow{", "}", "arrow over"),
      s("\\overbrace{ab}^{n}", "\\overbrace{", "}^{}", "brace over"), s("\\underbrace{ab}_{n}", "\\underbrace{", "}_{}", "brace under"),
      s("\\mathbf{v}", "\\mathbf{", "}", "bold, upright", { words: "vector" }), s("\\boldsymbol{\\alpha}", "\\boldsymbol{", "}", "bold symbol", AMSMATH),
      s("\\mathbb{R}", "\\mathbb{", "}", "blackboard bold", AMS), s("\\mathcal{A}", "\\mathcal{", "}", "calligraphic"), s("\\mathrm{d}", "\\mathrm{", "}", "upright, roman"),
      s("\\text{if}", "\\text{", "}", "words in a formula", { ...AMSMATH, words: "text" }),
    ],
  },
  {
    id: "structures",
    label: "Structures",
    symbols: [
      s("\\frac{a}{b}", "\\frac{", "}{}", "fraction", { words: "divide over" }), s("\\sqrt{x}", "\\sqrt{", "}", "square root"),
      s("\\sqrt[n]{x}", "\\sqrt[n]{", "}", "root"), s("x^{2}", "^{", "}", "superscript", { words: "power exponent" }),
      s("x_{i}", "_{", "}", "subscript", { words: "index" }), s("x_{i}^{2}", "_{", "}^{}", "subscript and superscript"),
      s("\\sum_{i=1}^{n}", "\\sum_{i=1}^{n} ", "", "sum with limits"), s("\\prod_{i=1}^{n}", "\\prod_{i=1}^{n} ", "", "product with limits"),
      s("\\int_{a}^{b}", "\\int_{a}^{b} ", " \\,\\mathrm{d}x", "integral with limits"), s("\\lim_{x \\to \\infty}", "\\lim_{x \\to \\infty} ", "", "limit with a variable"),
      s("\\binom{n}{k}", "\\binom{", "}{}", "binomial coefficient", { ...AMSMATH, words: "choose" }),
      s("\\left( x \\right)", "\\left( ", " \\right)", "parentheses that grow", { words: "brackets" }), s("\\left[ x \\right]", "\\left[ ", " \\right]", "square brackets that grow"),
      s("\\left\\{ x \\right\\}", "\\left\\{ ", " \\right\\}", "braces that grow"), s("\\left| x \\right|", "\\left| ", " \\right|", "absolute value"),
      s("\\left\\| x \\right\\|", "\\left\\| ", " \\right\\|", "norm"),
      s("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "\\begin{pmatrix} ", " &  \\\\  &  \\end{pmatrix}", "matrix in parentheses", AMSMATH),
      s("\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", "\\begin{bmatrix} ", " &  \\\\  &  \\end{bmatrix}", "matrix in brackets", AMSMATH),
      s("\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", "\\begin{vmatrix} ", " &  \\\\  &  \\end{vmatrix}", "determinant", AMSMATH),
      s("\\begin{cases} a & x>0 \\\\ b & x\\le 0 \\end{cases}", "\\begin{cases} ", " & \\text{if } \\\\  & \\text{otherwise} \\end{cases}", "cases", { ...AMSMATH, words: "piecewise" }),
    ],
  },
  {
    id: "text",
    label: "Text",
    symbols: [
      t("©", "\\textcopyright", "copyright"), t("®", "\\textregistered", "registered"), t("™", "\\texttrademark", "trade mark"),
      t("§", "\\S", "section sign"), t("¶", "\\P", "pilcrow, paragraph sign"), t("–", "--", "en dash", { words: "range" }), t("—", "---", "em dash"),
      { glyph: "“ ”", name: "quotation marks", textWrap: ["``", "''"], words: "quotes double" }, { glyph: "‘ ’", name: "single quotation marks", textWrap: ["`", "'"], words: "quotes" },
      t("€", "\\texteuro", "euro"), both("£", "\\pounds", "\\pounds", "pound sterling"), t("¥", "\\textyen", "yen"), t("¢", "\\textcent", "cent"),
      t("½", "\\textonehalf", "one half"), t("¼", "\\textonequarter", "one quarter"), t("¾", "\\textthreequarters", "three quarters"),
      t("‰", "\\textperthousand", "per thousand, per mille"), t("№", "\\textnumero", "numero"), t("℃", "\\textcelsius", "degree Celsius"),
    ],
  },
  {
    id: "special",
    label: "Special",
    symbols: [
      t("$", "\\$", "dollar sign"), t("%", "\\%", "percent sign"), t("&", "\\&", "ampersand"), t("#", "\\#", "hash, number sign"),
      t("_", "\\_", "underscore"), both("{", "\\{", "\\{", "left brace"), both("}", "\\}", "\\}", "right brace"), t("\\", "\\textbackslash", "backslash"),
      t("~", "\\textasciitilde", "tilde"), t("^", "\\textasciicircum", "caret, circumflex"), t("⍽", "~", "non-breaking space", { words: "nbsp tie" }),
      both("ᵗʰ", "\\,", "\\,", "thin space"), both("␣␣", "\\quad", "\\quad", "wide space, quad"),
    ],
  },
];

export const ALL_SYMBOLS: Sym[] = CATEGORIES.flatMap((c) => c.symbols);

/** The symbols whose name, LaTeX or look matches what was typed, best first. */
export function findSymbols(query: string): Sym[] {
  const q = query.trim().toLowerCase().replace(/^\\/, "");
  if (!q) return [];
  const scored: { sym: Sym; score: number }[] = [];
  for (const sym of ALL_SYMBOLS) {
    const latex = [sym.math, sym.text, sym.wrap?.[0], sym.textWrap?.[0]].filter(Boolean).map((x) => x!.toLowerCase().replace(/\\/g, ""));
    const name = sym.name.toLowerCase();
    let score = 0;
    if (sym.glyph === query.trim() || latex.includes(q)) score = 4;
    else if (name === q || name.startsWith(`${q},`)) score = 3;
    else if (name.split(/[\s,-]+/).some((word) => word.startsWith(q)) || latex.some((l) => l.startsWith(q))) score = 2;
    else if (name.includes(q) || (sym.words ?? "").includes(q)) score = 1;
    if (score) scored.push({ sym, score });
  }
  // Each symbol once, even where two lists hold it.
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .map((x) => x.sym)
    .filter((sym) => !seen.has(symbolId(sym)) && Boolean(seen.add(symbolId(sym))));
}

/** The symbols named by `ids`, in that order, skipping any no longer offered. */
export function symbolsById(ids: string[]): Sym[] {
  const by = new Map(ALL_SYMBOLS.map((sym) => [symbolId(sym), sym]));
  return ids.map((id) => by.get(id)).filter((sym): sym is Sym => Boolean(sym));
}

/** Environments whose body is mathematics. */
const MATH_ENVS = /^(?:equation|align|alignat|flalign|gather|multline|eqnarray|displaymath|math|dmath|IEEEeqnarray)\*?$/;
/** Commands whose argument is text again, inside a formula. */
const TEXT_IN_MATH = /^(?:text|textrm|textit|textbf|textsf|texttt|textnormal|textup|mbox|hbox|intertext|shortintertext|emph)$/;
/** Environments whose body is not LaTeX at all. */
const VERBATIM = /^(?:verbatim|Verbatim|lstlisting|minted|comment)\*?$/;

/**
 * Whether the place `pos` in `text` is inside a formula: $…$, $$…$$, \(…\), \[…\], a
 * mathematics environment, and not inside \text{…} or the like within one.
 */
export function mathAt(text: string, pos: number): boolean {
  // Each open thing: a formula, a piece of text inside one, or just a group of braces.
  const open: { kind: "math" | "text" | "group"; close: string }[] = [];
  const top = () => open[open.length - 1]?.close;
  const math = () => {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].kind !== "group") return open[i].kind === "math";
    return false;
  };
  const end = Math.min(pos, text.length);
  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (ch === "%") {
      const stop = text.indexOf("\n", i);
      if (stop < 0 || stop >= end) return math();
      i = stop;
    } else if (ch === "\\") {
      const next = text[i + 1] ?? "";
      if (next === "(" || next === "[") open.push({ kind: "math", close: `\\${next === "(" ? ")" : "]"}` });
      else if ((next === ")" || next === "]") && top() === `\\${next}`) open.pop();
      if (!/[a-zA-Z@]/.test(next)) {
        i++;
        continue;
      }
      const name = /^[a-zA-Z@]+\*?/.exec(text.slice(i + 1, i + 40))![0];
      if (/^(?:verb|lstinline|Verb)\*?$/.test(name)) {
        // Verbatim in a line, up to the same mark again: nothing in it is LaTeX.
        const mark = text[i + 1 + name.length];
        const close = mark ? text.indexOf(mark, i + 2 + name.length) : -1;
        if (close < 0 || close >= end) return math();
        i = close;
        continue;
      }
      const env = name === "begin" || name === "end" ? /^\{([^{}]*)\}/.exec(text.slice(i + 1 + name.length, i + 80)) : null;
      if (env && name === "begin" && VERBATIM.test(env[1])) {
        const close = text.indexOf(`\\end{${env[1]}}`, i);
        if (close < 0 || close >= end) return false;
        i = close + env[1].length + 5;
        continue;
      }
      if (env && name === "begin" && MATH_ENVS.test(env[1])) open.push({ kind: "math", close: `\\end{${env[1]}}` });
      else if (env && name === "end" && top() === `\\end{${env[1]}}`) open.pop();
      else if (TEXT_IN_MATH.test(name) && math()) {
        // The braces after it hold text; they are taken as the group they open.
        let at = i + 1 + name.length;
        while (text[at] === " ") at++;
        if (text[at] === "{" && at < end) {
          open.push({ kind: "text", close: "}" });
          i = at;
          continue;
        }
      }
      i += name.length;
      if (env) i += env[0].length;
    } else if (ch === "{") open.push({ kind: "group", close: "}" });
    else if (ch === "}") {
      if (top() === "}") open.pop();
    } else if (ch === "$") {
      // Inside $…$ a dollar always closes it, even when another follows at once: $x$$y$ is
      // two formulas, not one and the start of a display.
      if (top() === "$") open.pop();
      else if (text[i + 1] === "$") {
        if (top() === "$$") open.pop();
        else open.push({ kind: "math", close: "$$" });
        i++;
      } else open.push({ kind: "math", close: "$" });
    }
  }
  return math();
}

/**
 * What to write, made by `make`, for the text from `from` to `to`, and where. A formula symbol
 * put straight after a formula in the line goes inside that formula, before its closing $,
 * rather than starting one of its own next to it.
 */
export function placeInsertion(
  text: string,
  from: number,
  to: number,
  make: (inMath: boolean, next: string) => Insertion,
): { from: number; to: number; ins: Insertion } {
  const inMath = mathAt(text, from);
  const ins = make(inMath, text.slice(to, to + 1));
  const opensFormula = ins.before.startsWith("$") && !ins.before.startsWith("$$");
  const closes = from > 0 && text[from - 1] === "$" && text[from - 2] !== "$" && text[from - 2] !== "\\";
  if (!inMath && from === to && opensFormula && closes && mathAt(text, from - 1)) {
    return { from: from - 1, to: from - 1, ins: make(true, "$") };
  }
  return { from, to, ins };
}

export interface Insertion {
  /** Written before the selected text, and after it. The selection stays between them. */
  before: string;
  after: string;
  pkg?: Sym["pkg"];
}

/**
 * What to write for a symbol, given whether it goes inside a formula and the character just
 * after where it goes. A command whose name ends in a letter must not run into a letter that
 * follows it: in a formula a space keeps them apart, and in text, where a space would be
 * swallowed, an empty group does.
 */
export function insertion(sym: Sym, inMath: boolean, next = ""): Insertion {
  const pkg = sym.pkg;
  const word = (tex: string) => /\\[a-zA-Z]+$/.test(tex);
  if (sym.textWrap) {
    const [b, a] = sym.textWrap;
    return inMath ? { before: `\\mbox{${b}`, after: `${a}}`, pkg } : { before: b, after: a, pkg };
  }
  if (sym.wrap) {
    const [b, a] = sym.wrap;
    return inMath ? { before: b, after: a, pkg } : { before: `$${b}`, after: `${a}$`, pkg };
  }
  if (inMath && sym.math) return { before: sym.math + (word(sym.math) && !/^\s/.test(next) ? " " : ""), after: "", pkg };
  if (!inMath && sym.text) return { before: sym.text + (word(sym.text) && (next === "" || /^[\sa-zA-Z]/.test(next)) ? "{}" : ""), after: "", pkg };
  if (inMath) return { before: `\\mbox{${sym.text}}`, after: "", pkg };
  return { before: `$${sym.math}$`, after: "", pkg };
}
