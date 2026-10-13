import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { applicationDocumentUrl } from "@/server/services/agency-application.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams an agency-application document through a short-lived signed URL after the applicant / reviewer check (INV-P6). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const url = await applicationDocumentUrl(prisma, auth.actor, id);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
