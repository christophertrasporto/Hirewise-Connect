import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { acceptanceReport, acceptanceReportCsv } from "@/server/services/terms.service";
import { ForbiddenError } from "@/server/policies/authorize";

export const runtime = "nodejs";

/** Identity phase 1: CSV export of terms acceptance status (terms.report). */
export async function GET(req: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const status = q.get("status");
  try {
    const r = await acceptanceReport(prisma, auth.actor, { role: q.get("role"), agencyId: q.get("agencyId"), q: q.get("q"), status: status === "CURRENT" || status === "OUTDATED" || status === "NONE" ? status : null });
    return new NextResponse(acceptanceReportCsv(r.rows), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="terms-acceptances-${new Date().toISOString().slice(0, 10)}.csv"` } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
