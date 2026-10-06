import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { runWorkerOnce, runMaintenance } from "@/server/jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * One worker pass on demand: drains the outbox (notifications, emails, SMS) and due jobs, then housekeeping.
 * Lets a serverless deployment without a long-running `npm run worker` still deliver mail. Vercel Cron calls it
 * with `Authorization: Bearer <CRON_SECRET>` (see vercel.json); any external pinger can do the same.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  const passes: Array<{ events: number; jobs: number; failures: number }> = [];
  // Keep draining while there is work, within the function's time budget.
  for (let i = 0; i < 10; i++) {
    const r = await runWorkerOnce(prisma);
    passes.push(r);
    if (r.events === 0 && r.jobs === 0) break;
    if (Date.now() - startedAt > 40_000) break;
  }
  const maintenance = await runMaintenance(prisma);
  const totals = passes.reduce((a, r) => ({ events: a.events + r.events, jobs: a.jobs + r.jobs, failures: a.failures + r.failures }), { events: 0, jobs: 0, failures: 0 });
  return NextResponse.json({ ok: true, ...totals, passes: passes.length, maintenance, ms: Date.now() - startedAt }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
