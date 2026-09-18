import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ESLint for the single Next.js application (task T006). Prettier owns formatting
// (see .prettierrc); ESLint owns correctness rules from eslint-config-next.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Constitution IX: explicit types over implicit any; allow underscore-prefixed unused args.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project additions:
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "supabase/.temp/**",
    ".agents/**",
    ".agents-backup/**",
  ]),
]);

export default eslintConfig;
