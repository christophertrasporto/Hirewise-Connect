import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { recordClick, cookieDays, hashIp, REFERRAL_COOKIE } from "@/server/services/referral.service";
import { rateLimit } from "@/server/auth/rate-limit";
import { logger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Referral entry point: /join?ref=CODE. A live code is logged as a click and stored in a first-party cookie for the
 * configured number of days (a later link overwrites it, so the last click wins); any visitor then lands on sign-up.
 * An unknown, malformed, or rate-limited code simply continues to sign-up with no cookie. Agency invite links live at
 * /join/[token] and are not affected.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/register", req.url));
  res.headers.set("Cache-Control", "no-store");
  const code = req.nextUrl.searchParams.get("ref")?.trim().toUpperCase() ?? null;
  if (!code) return res;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || null;
  try {
    rateLimit(`ref-click:${hashIp(ip) ?? "unknown"}`, 60, 60 * 60_000);
    const { ok } = await recordClick(prisma, code, { ip, userAgent: req.headers.get("user-agent"), landingUrl: `${req.nextUrl.pathname}${req.nextUrl.search}` });
    if (ok) {
      const days = await cookieDays(prisma);
      res.cookies.set(REFERRAL_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: days * 86_400 });
    }
  } catch (e) {
    // A rate limit or a database hiccup must never block someone from signing up.
    logger.warn({ err: e instanceof Error ? { name: e.name, message: e.message } : e }, "referral click not recorded");
  }
  return res;
}
