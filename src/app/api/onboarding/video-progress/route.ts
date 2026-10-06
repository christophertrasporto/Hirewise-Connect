import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { recordVideoProgress } from "@/server/services/onboarding.service";
import { toActionError } from "@/server/http/action-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progress beacon from the welcome-video player: called every few seconds while playing and on pause / page
 * hide (navigator.sendBeacon posts text/plain, so the body is parsed manually). Returns the stored state so the
 * player can show the percentage and the completed mark.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const r = await recordVideoProgress(prisma, auth.actor, body as never);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const r = toActionError(e);
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
}
