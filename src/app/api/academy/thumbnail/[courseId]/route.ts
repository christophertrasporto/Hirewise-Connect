import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { publicCoverKey } from "@/server/services/public-catalog.service";
import { coverUrlFor } from "@/server/services/course-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A stable public address for a published course cover. Pages, cards, share cards and the sitemap point here; the answer
 * is a short-lived signed link to the private file, cached briefly (shorter than the link lives) by browsers and the CDN.
 * Drafts and archived courses have no public cover and answer 404. The page address carries `?v=` so a new cover shows at once.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const key = await publicCoverKey(prisma, courseId);
  const url = key ? await coverUrlFor({ id: courseId, thumbnailKey: key }) : null;
  if (!url) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=300" } });
}
