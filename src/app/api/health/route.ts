import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness and readiness for the hosting platform: process up and database reachable. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const stale = await prisma.outboxEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } } });
    return NextResponse.json({ status: "ok", database: "ok", worker: stale === 0 ? "ok" : "lagging", staleEvents: stale, latencyMs: Date.now() - startedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
