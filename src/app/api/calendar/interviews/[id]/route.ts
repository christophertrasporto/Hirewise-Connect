import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { interviewCalendar } from "@/server/services/interview.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";

/** .ics download for a scheduled interview (client contact, candidate, or staff). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const cal = await interviewCalendar(prisma, auth.actor, id.replace(/\.ics$/, ""));
    return new NextResponse(cal.ics, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${cal.filename}"` } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
