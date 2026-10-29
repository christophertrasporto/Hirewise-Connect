import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { profilePhotoUrl } from "@/server/services/media.service";
import { NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shows a talent profile photo by redirecting to a short-lived signed URL. Allowed for the profile's owner and for staff
 * who can read profiles; everyone else, clients included, gets 404 so the route reveals nothing. Pages put this address in
 * an <img>, so the storage address never sits in the HTML.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ agentProfileId: string }> }) {
  const auth = await getCurrentAuth();
  const { agentProfileId } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const url = await profilePhotoUrl(prisma, auth.actor, agentProfileId);
    return NextResponse.redirect(url, { status: 302, headers });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    throw e;
  }
}
