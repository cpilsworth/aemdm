import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".npm-cache/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["test/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        test: "readonly",
        vi: "readonly",
      },
    },
  },
);
