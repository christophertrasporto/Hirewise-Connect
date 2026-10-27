import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { recordClick, cookieDays, hashIp, REFERRAL_COOKIE } from "@/server/services/referral.service";
import { rateLimit } from "@/server/auth/rate-limit";
import { logger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Referral capture for pages other than /join: a page that was opened with ?ref=CODE (a course page, for example) posts
 * the code here, and it is logged as a click and stored in the same first-party cookie /join sets, so the referrer is
 * still credited at sign-up. Never blocks the page: an unknown, malformed, or rate-limited code just does nothing.
 */
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  let body: { ref?: unknown; path?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return res;
  }
  const code = typeof body.ref === "string" ? body.ref.trim().toUpperCase().slice(0, 40) : "";
  if (!code) return res;
  const path = typeof body.path === "string" && body.path.startsWith("/") && !body.path.startsWith("//") ? body.path.slice(0, 200) : "/";
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || null;
  try {
    rateLimit(`ref-click:${hashIp(ip) ?? "unknown"}`, 60, 60 * 60_000);
    const { ok } = await recordClick(prisma, code, { ip, userAgent: req.headers.get("user-agent"), landingUrl: path });
    if (ok) {
      const days = await cookieDays(prisma);
      res.cookies.set(REFERRAL_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: days * 86_400 });
    }
  } catch (e) {
    logger.warn({ err: e instanceof Error ? { name: e.name, message: e.message } : e }, "referral click not recorded");
  }
  return res;
}
