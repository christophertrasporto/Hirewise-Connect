import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { pipelineReport, revenueReport, marginReport, parseRange, toCsv } from "@/server/services/report.service";
import { ForbiddenError } from "@/server/policies/authorize";

export const runtime = "nodejs";

/** CSV export for Section 11 reports. Authorization is the report service's. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { report } = await ctx.params;
  const range = parseRange(req.nextUrl.searchParams.get("from") ?? undefined, req.nextUrl.searchParams.get("to") ?? undefined);
  try {
    let rows: Array<Record<string, unknown>>;
    if (report === "pipeline") {
      const p = await pipelineReport(prisma, auth.actor, range);
      rows = [{ from: p.range.from, to: p.range.to, interviewRequests: p.interviewRequests, selectionsInRange: p.selectionsInRange, depositsSettledInRange: p.depositsSettledInRange, awaitingAgreement: p.awaitingAgreement, awaitingDeposit: p.awaitingDeposit, deploymentPrep: p.deploymentPrep, active: p.active, completed: p.completed, cancelled: p.cancelled }];
    } else if (report === "revenue") {
      const r = await revenueReport(prisma, auth.actor, range);
      rows = r.placements.map((p) => ({ client: p.client, agent: p.agent, position: p.position, status: p.status, rate: p.rateLabel, monthlyBilling: (p.monthlyBilling / 100).toFixed(2), currency: p.currency, activatedAt: p.activatedAt }));
    } else if (report === "margin") {
      const m = await marginReport(prisma, auth.actor);
      rows = m.rows.map((r) => ({ client: r.client, agent: r.agent, status: r.status, monthlyBilling: (r.monthlyBilling / 100).toFixed(2), monthlyCompensation: r.monthlyCompensation === null ? "" : (r.monthlyCompensation / 100).toFixed(2), margin: r.margin === null ? "" : (r.margin / 100).toFixed(2), marginPct: r.marginPct ?? "", currency: r.currency }));
    } else return NextResponse.json({ error: "Unknown report" }, { status: 404 });
    return new NextResponse(toCsv(rows), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report}-${range.to.toISOString().slice(0, 10)}.csv"` } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
