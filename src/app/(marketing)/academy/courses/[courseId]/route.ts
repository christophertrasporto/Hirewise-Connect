import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { publicSlugForCourseId } from "@/server/services/public-catalog.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The first public course address used the course id. Those links are in emails and shared posts, so they keep working: a
 * permanent redirect to the course address, with the query kept (an affiliate `?ref=` still reaches the new page).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const slug = /^[A-Za-z0-9_-]{8,40}$/.test(courseId) ? await publicSlugForCourseId(prisma, courseId) : null;
  if (!slug) return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  const to = req.nextUrl.clone();
  to.pathname = `/academy/${slug}`;
  return NextResponse.redirect(to, { status: 301, headers: { "Cache-Control": "public, max-age=3600" } });
}
