import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.claude` holds other working copies of the project (git worktrees), each linted on its own.
  { ignores: ["dist", "src-tauri", "src/ipc/bindings", "mockup", "scripts", ".claude"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
