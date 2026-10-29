import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { myWalletCsv } from "@/server/services/wallet.service";
import { ForbiddenError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in coach's sales as a CSV, with the same filters as the Wallet page. Always the caller's own data. */
export async function GET(req: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  try {
    const csv = await myWalletCsv(prisma, auth.actor, { courseId: q.get("course") || undefined, from: q.get("from") || undefined, to: q.get("to") || undefined });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="hirewise-coach-sales-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (e instanceof Error && e.name === "ZodError") return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
    throw e;
  }
}
