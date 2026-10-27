import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { lessonDownloadUrl } from "@/server/services/academy.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { LessonAccessError } from "@/server/policies/lesson-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams an uploaded lesson file by redirecting to a short-lived signed URL (two hours for video).
 * Access is the shared lesson rule: a published free preview is open to anyone, signed in or not; a gated lesson needs
 * an owner of the course or staff who manage it. Signed out on a gated lesson answers 401, signed in without the course
 * 403, and an unknown or unpublished lesson 404. Pages embed this route in <video>, <audio>, and download links, so the
 * signed bucket URL never sits in the HTML or in an API response.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const auth = await getCurrentAuth();
  const { lessonId } = await ctx.params;
  try {
    const url = await lessonDownloadUrl(prisma, auth?.actor ?? null, lessonId);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof LessonAccessError) return NextResponse.json({ error: e.denial === "SIGN_IN" ? "Unauthorized" : "Forbidden" }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    throw e;
  }
}
