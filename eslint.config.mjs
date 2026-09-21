import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Import boundary (INV-A2).
 *
 * - `@prisma/client` (queries, types, enums) may be imported only from src/server/db/**
 *   and src/server/repositories/**. Everywhere else names a transaction through the
 *   type-only module @/server/db/types.
 * - The client *handle* (`@/server/db/client`) may additionally be obtained by the thin
 *   entry layer (src/app/** pages, server actions, route handlers, and the request gate)
 *   solely to pass it into services. Services and everything below receive it as a
 *   parameter and may not import it, which keeps them testable against any database.
 *
 * Verified by tests/lint/prisma-boundary.test.ts.
 */
const MESSAGE = "Prisma is only imported in src/server/db/** and src/server/repositories/** (INV-A2). Use a repository, or the type-only module @/server/db/types.";

const FULL_BOUNDARY = {
  patterns: [{ group: ["@prisma/client", "@prisma/client/*", "@/server/db/client", "**/server/db/client"], message: MESSAGE, allowTypeImports: false }],
};

const ENTRY_LAYER_BOUNDARY = {
  patterns: [{ group: ["@prisma/client", "@prisma/client/*"], message: `${MESSAGE} Entry points may import the handle from @/server/db/client only to pass it into services.`, allowTypeImports: false }],
};

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "prisma/migrations/**", ".pgdata/**", ".storage/**", "next-env.d.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", FULL_BOUNDARY],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/server/auth/require-actor.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", ENTRY_LAYER_BOUNDARY],
    },
  },
  {
    files: ["src/server/db/**/*.ts", "src/server/repositories/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "prisma/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
