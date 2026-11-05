import { inject } from "vitest";
import { createPrismaClient } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/types";

let client: PrismaClient | null = null;

/** Prisma client bound to the test database started by global-setup. */
export function testDb(): PrismaClient {
  if (!client) {
    // Mirror production (Vercel behind the Supabase transaction pooler runs with connection_limit=1): any query that
    // bypasses the transaction handle inside an interactive transaction deadlocks here instead of only in production.
    const base = inject("databaseUrl");
    const url = base + (base.includes("?") ? "&" : "?") + "connection_limit=1&pool_timeout=5";
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

/**
 * Gives a course the welcome video every live course needs (a published, uploaded, free-preview video that is not
 * required), so fixtures that publish a course need not each build one. Does nothing when the course has no published
 * module yet (so "no lesson" refusals are unaffected) or already has one. It sits first in its module (as a real welcome lesson does, so
 * sequential unlock never locks it) and is optional, so it never changes completion.
 */
export async function addWelcomeVideo(db: PrismaClient, courseId: string) {
  const mod = await db.courseModule.findFirst({ where: { courseId, status: "PUBLISHED" }, orderBy: { order: "asc" } });
  if (!mod) return;
  const has = await db.courseLesson.findFirst({ where: { module: { courseId }, status: "PUBLISHED", isFreePreview: true, contentType: "VIDEO", storageKey: { not: null } } });
  if (has) return;
  const first = await db.courseLesson.aggregate({ where: { moduleId: mod.id }, _min: { order: true } });
  await db.courseLesson.create({ data: { moduleId: mod.id, order: (first._min.order ?? 1) - 1, title: "Welcome video", contentType: "VIDEO", storageKey: `lessons/${courseId}/welcome.mp4`, fileName: "welcome.mp4", contentMime: "video/mp4", sizeBytes: 1, durationSec: 60, status: "PUBLISHED", isFreePreview: true, isRequired: false } });
}
