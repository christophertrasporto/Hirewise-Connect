import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { NotFoundError } from "@/server/policies/authorize";
import { getCourseViewer } from "@/server/services/public-catalog.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The part of a public course page that depends on who is looking (Buy course or Continue learning, their own review,
 * whether they have a share link). The page itself is cached and identical for everyone; this answers with no caching.
 */
export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get("courseId") ?? "";
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(courseId)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const auth = await getCurrentAuth();
  try {
    return NextResponse.json(await getCourseViewer(prisma, auth?.actor ?? null, courseId), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    throw e;
  }
}
