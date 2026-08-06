// Flat config shared by every workspace package. `pnpm lint` previously failed
// with "eslint: command not found" — the packages declared a lint script but
// nothing installed or configured ESLint.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/artifacts/**",
      "**/cache/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // This codebase leans on `any` at the API and DB boundaries. Flagging
      // every one would bury the findings that matter, so it is a warning.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // A caught error that is not re-read is common in handlers that
          // report a fixed message; the signal is too weak to gate on, while
          // unused imports and variables are real dead code.
          caughtErrors: "none",
        },
      ],
      // Empty catch blocks are used deliberately for optional lookups.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Tests and scripts run in Node and legitimately use console and process.
    files: ["**/tests/**/*.ts", "**/test/**/*.ts", "**/scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // CommonJS config files (PM2 ecosystem, PostCSS, Tailwind) legitimately
    // use module/require.
    files: ["**/*.cjs", "**/*.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
