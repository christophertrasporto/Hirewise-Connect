import { inject } from "vitest";
import { createPrismaClient } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/types";

let client: PrismaClient | null = null;

/** Prisma client bound to the test database started by global-setup. */
export function testDb(): PrismaClient {
  if (!client) {
    const url = inject("databaseUrl");
    process.env.DATABASE_URL = url;
    client = createPrismaClient(url);
  }
  return client;
}

/** Truncate all application tables between test files. Order does not matter with CASCADE. */
export async function resetDb(db: PrismaClient) {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
