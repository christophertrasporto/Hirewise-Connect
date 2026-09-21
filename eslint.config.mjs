import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Import boundary (INV-A2): Prisma may be imported only from src/server/db and
 * src/server/repositories. Everything else names a transaction through the
 * type-only module @/server/db/types. Verified by tests/lint/prisma-boundary.test.ts.
 */
const PRISMA_BOUNDARY = {
  patterns: [
    {
      // @/server/db/types is deliberately absent: it exports types only and is allowed everywhere.
      group: ["@prisma/client", "@prisma/client/*", "@/server/db/client", "**/server/db/client"],
      message: "Prisma is only imported in src/server/db/** and src/server/repositories/** (INV-A2). Use a repository, or the type-only module @/server/db/types.",
      allowTypeImports: false,
    },
  ],
};

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "prisma/migrations/**", ".pgdata/**", ".storage/**", "next-env.d.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", PRISMA_BOUNDARY],
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
