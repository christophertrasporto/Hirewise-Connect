import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { lessonDownloadUrl } from "@/server/services/academy.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams an uploaded lesson file by redirecting to a short-lived signed URL.
 * The service enforces access: course coaches and admins, or an enrolled agent whose enrolment is unlocked.
 * Pages embed this URL in <video>, <audio>, and download links so the signed URL never sits in the HTML.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { lessonId } = await ctx.params;
  try {
    const url = await lessonDownloadUrl(prisma, auth.actor, lessonId);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
