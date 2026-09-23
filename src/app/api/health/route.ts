import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Classify a database failure without leaking anything from the connection string.
 * Only the category and Prisma's error code (P1000..P1017, P2021) are returned.
 */
function classify(err: unknown): { reason: string; code: string | null } {
  const e = err as { code?: string; message?: string } | null;
  const code = typeof e?.code === "string" ? e.code : null;
  const msg = (e?.message ?? "").toLowerCase();
  if (code === "P1000" || msg.includes("password authentication failed")) return { reason: "authentication_failed", code };
  if (msg.includes("tenant or user not found")) return { reason: "pooler_user_not_found", code };
  if (code === "P1001" || msg.includes("can't reach database") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("getaddrinfo")) return { reason: "host_unreachable", code };
  if (code === "P1002" || code === "P1008" || msg.includes("timed out") || msg.includes("timeout")) return { reason: "timeout", code };
  if (code === "P1003" || msg.includes("does not exist") || code === "P2021") return { reason: "schema_missing", code };
  if (code === "P1013" || msg.includes("invalid") && msg.includes("url")) return { reason: "invalid_connection_string", code };
  if (msg.includes("prepared statement")) return { reason: "pooler_needs_pgbouncer_flag", code };
  if (msg.includes("ssl") || msg.includes("tls")) return { reason: "tls", code };
  return { reason: "unknown", code };
}

/** Liveness and readiness for the hosting platform: process up and database reachable. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const stale = await prisma.outboxEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } } });
    return NextResponse.json({ status: "ok", database: "ok", worker: stale === 0 ? "ok" : "lagging", staleEvents: stale, latencyMs: Date.now() - startedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { reason, code } = classify(err);
    return NextResponse.json({ status: "degraded", database: "unreachable", reason, code, databaseUrlSet: !!process.env.DATABASE_URL, directUrlSet: !!process.env.DIRECT_URL, latencyMs: Date.now() - startedAt }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
