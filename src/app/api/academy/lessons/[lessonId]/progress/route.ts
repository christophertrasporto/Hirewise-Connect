import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { recordMediaProgress } from "@/server/services/lesson-media.service";
import { toActionError } from "@/server/http/action-result";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progress beacon from the audio / video lesson player: every few seconds while playing and on pause or page hide
 * (navigator.sendBeacon posts text/plain, so the body is parsed manually). Returns the stored state so the player
 * can show the listened share, the resume position, and whether the quiz is unlocked.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ lessonId: string }> }) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { lessonId } = await ctx.params;
  let body: unknown = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const r = await recordMediaProgress(prisma, auth.actor, lessonId, body as never);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    const r = toActionError(e);
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
}
