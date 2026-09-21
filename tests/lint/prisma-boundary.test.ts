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

describe("Prisma import boundary", () => {
  it("blocks @prisma/client in a service", async () => {
    const v = await violations(`import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`, "src/server/services/example.service.ts");
    expect(v.length).toBeGreaterThan(0);
  });

  it("blocks the db client module in a route handler", async () => {
    const v = await violations(`import { prisma } from "@/server/db/client";\nexport const x = prisma;\n`, "src/app/api/example/route.ts");
    expect(v.length).toBeGreaterThan(0);
  });

  it("blocks type-only imports of @prisma/client outside the boundary", async () => {
    const v = await violations(`import type { Prisma } from "@prisma/client";\nexport type T = Prisma.TransactionClient;\n`, "src/server/services/example.service.ts");
    expect(v.length).toBeGreaterThan(0);
  });

  it("allows the type-only module @/server/db/types anywhere", async () => {
    const v = await violations(`import type { Tx } from "@/server/db/types";\nexport type T = Tx;\n`, "src/server/services/example.service.ts");
    expect(v).toEqual([]);
  });

  it("allows @prisma/client inside repositories and db", async () => {
    const a = await violations(`import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`, "src/server/repositories/example.repository.ts");
    const b = await violations(`import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`, "src/server/db/client.ts");
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
