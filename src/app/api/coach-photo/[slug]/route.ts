import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { coachPhotoAccess } from "@/server/services/public-catalog.service";
import { getStorage } from "@/server/adapters/storage";
import { COVER_URL_TTL_SECONDS } from "@/lib/course-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * A coach photo. Anyone may see it while the coach page is live (switched on, with a published and listed course); until
 * then only the coach and staff who manage courses can, so a photo never leaks before the page does.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const photo = await coachPhotoAccess(prisma, slug);
  if (!photo) return NOT_FOUND();
  let cache = "public, max-age=300, s-maxage=1800, stale-while-revalidate=300";
  if (!photo.live) {
    const auth = await getCurrentAuth();
    const allowed = !!auth && (auth.actor.userId === photo.ownerUserId || auth.actor.permissions.has("course.manage"));
    if (!allowed) return NOT_FOUND();
    cache = "private, no-store";
  }
  try {
    const url = await getStorage().createDownloadUrl(photo.key, COVER_URL_TTL_SECONDS);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": cache } });
  } catch {
    return NOT_FOUND();
  }
}
