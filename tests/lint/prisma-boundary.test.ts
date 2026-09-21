import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

/**
 * Proves the import boundary (INV-A2) is enforced by tooling, not convention.
 * Lints in-memory files at representative paths so the test never touches disk.
 */
const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
const RULE = "@typescript-eslint/no-restricted-imports";

async function violations(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === RULE);
}

const PRISMA_IMPORT = `import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`;
const HANDLE_IMPORT = `import { prisma } from "@/server/db/client";\nexport const x = prisma;\n`;
const TYPES_IMPORT = `import type { Tx } from "@/server/db/types";\nexport type T = Tx;\n`;

describe("Prisma import boundary", () => {
  it("blocks @prisma/client in a service, a view, and a route handler", async () => {
    expect((await violations(PRISMA_IMPORT, "src/server/services/example.service.ts")).length).toBeGreaterThan(0);
    expect((await violations(PRISMA_IMPORT, "src/server/views/example.views.ts")).length).toBeGreaterThan(0);
    expect((await violations(PRISMA_IMPORT, "src/app/api/example/route.ts")).length).toBeGreaterThan(0);
  });

  it("blocks type-only imports of @prisma/client outside the boundary", async () => {
    const v = await violations(`import type { Prisma } from "@prisma/client";\nexport type T = Prisma.TransactionClient;\n`, "src/server/services/example.service.ts");
    expect(v.length).toBeGreaterThan(0);
  });

  it("blocks the client handle inside services, state machines, and views", async () => {
    expect((await violations(HANDLE_IMPORT, "src/server/services/example.service.ts")).length).toBeGreaterThan(0);
    expect((await violations(HANDLE_IMPORT, "src/server/state/example.ts")).length).toBeGreaterThan(0);
    expect((await violations(HANDLE_IMPORT, "src/components/Example.tsx")).length).toBeGreaterThan(0);
  });

  it("allows the client handle in the entry layer (pages, actions, route handlers) to pass into services", async () => {
    expect(await violations(HANDLE_IMPORT, "src/app/(app)/dashboard/page.tsx")).toEqual([]);
    expect(await violations(HANDLE_IMPORT, "src/app/(auth)/actions.ts")).toEqual([]);
    expect(await violations(HANDLE_IMPORT, "src/app/api/auth/magic/[token]/route.ts")).toEqual([]);
  });

  it("allows the type-only module @/server/db/types anywhere", async () => {
    expect(await violations(TYPES_IMPORT, "src/server/services/example.service.ts")).toEqual([]);
    expect(await violations(TYPES_IMPORT, "src/components/Example.tsx")).toEqual([]);
  });

  it("allows @prisma/client inside repositories and db", async () => {
    expect(await violations(PRISMA_IMPORT, "src/server/repositories/example.repository.ts")).toEqual([]);
    expect(await violations(PRISMA_IMPORT, "src/server/db/client.ts")).toEqual([]);
  });
});
