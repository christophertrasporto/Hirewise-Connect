import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { partnerDestination } from "@/server/services/partner-course.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const SLUG = /^[a-z0-9][a-z0-9-]{0,100}$/;
/** Link previews, search crawlers and browser prefetches follow the link but are not people pressing the button. */
const NOT_A_PERSON = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|linkedin|headless/i;

/**
 * The Take this course button of a partner course. Logs the press (a count per course) and redirects to the partner's
 * affiliate link, which is stored on the course and never appears in a page. Nothing here is cached, and a prefetch or a
 * crawler is redirected without being counted.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new NextResponse("Not found", { status: 404, headers: HEADERS });
  const prefetch = [req.headers.get("purpose"), req.headers.get("sec-purpose"), req.headers.get("next-router-prefetch")].some((v) => !!v && /prefetch/i.test(v) || v === "1");
  const count = !prefetch && !NOT_A_PERSON.test(req.headers.get("user-agent") ?? "");
  const auth = count ? await getCurrentAuth() : null;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : null;

  const found = await partnerDestination(prisma, slug, { userId: auth?.actor.userId ?? null, ip, count });
  if (!found) return new NextResponse("Not found", { status: 404, headers: HEADERS });
  if ("redirectSlug" in found) return NextResponse.redirect(new URL(`/go/${found.redirectSlug}`, req.url), { status: 308, headers: HEADERS });
  return NextResponse.redirect(found.url, { status: 302, headers: HEADERS });
}

/** A HEAD request (a link checker) is answered without a count and without following the link. */
export async function HEAD() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
