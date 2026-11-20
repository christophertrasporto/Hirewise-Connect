import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { purchasesCsvReport } from "@/server/services/purchase-report.service";
import { parsePurchaseQuery } from "@/lib/purchases";
import { ForbiddenError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every purchase matching the page's filters as a CSV. Staff who can record course payments only. */
export async function GET(req: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = parsePurchaseQuery(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.ok) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  try {
    const csv = await purchasesCsvReport(prisma, auth.actor, parsed.query);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="hirewise-course-purchases-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
