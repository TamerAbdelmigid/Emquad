// The environments whose body is mathematics: LaTeX's own, amsmath's, and a few from packages
// common in papers. One list, so that visual mode, spelling and the symbol panel agree.

export const MATH_ENVIRONMENTS = ["equation", "align", "alignat", "flalign", "gather", "multline", "eqnarray", "displaymath", "math", "dmath", "IEEEeqnarray"];

/** Matches the name of one of them, starred or not. */
export const MATH_ENVIRONMENT = new RegExp(`^(?:${MATH_ENVIRONMENTS.join("|")})\\*?$`);

/** The names alternated, for building a larger pattern. */
export const MATH_NAMES = `(?:${MATH_ENVIRONMENTS.join("|")})\\*?`;

/**
 * What KaTeX is given to draw an environment's body. The environments that line equations up
 * become `aligned`, `alignedat` or `gathered`, the forms that can stand in a single formula;
 * `math` is a formula in the line.
 */
export function mathForDrawing(name: string, body: string): { tex: string; display: boolean } {
  const bare = name.replace(/\*$/, "");
  if (bare === "math") return { tex: body, display: false };
  // alignat and IEEEeqnarray start with an argument: the number of columns, or their layout.
  const arg = /^\s*\{([^{}]*)\}/.exec(body);
  if (bare === "alignat" && arg) return { tex: `\\begin{alignedat}{${arg[1]}}${body.slice(arg[0].length)}\\end{alignedat}`, display: true };
  if (bare === "IEEEeqnarray" && arg) return { tex: `\\begin{aligned}${body.slice(arg[0].length)}\\end{aligned}`, display: true };
  if (bare === "gather") return { tex: `\\begin{gathered}${body}\\end{gathered}`, display: true };
  if (/^(?:align|flalign|eqnarray|multline)$/.test(bare)) return { tex: `\\begin{aligned}${body}\\end{aligned}`, display: true };
  return { tex: body, display: true };
}
