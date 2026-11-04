import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { isShareablePath, shareLinkFor } from "@/server/services/public-catalog.service";
import { rateLimit } from "@/server/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in member's own share link to a public Academy page (the address with their referral code). */
export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  let path: unknown;
  try {
    path = ((await req.json()) as { path?: unknown }).path;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400, headers: NO_STORE });
  }
  if (!isShareablePath(path)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  try {
    rateLimit(`share-link:${auth.actor.userId}`, 60, 60 * 60_000);
    return NextResponse.json({ url: await shareLinkFor(prisma, auth.actor, path) }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    throw e;
  }
}
