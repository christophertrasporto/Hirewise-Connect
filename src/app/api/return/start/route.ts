import { NextResponse, type NextRequest } from "next/server";
import { RETURN_COOKIE, RETURN_COOKIE_MAX_AGE, isBuyReturnPath, safeReturnPath } from "@/lib/return-to";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buy course, signed out: remember which course the visitor came for, then send them to sign up (default) or log in.
 * The destination is validated here and again when it is used; an invalid one is ignored and the visitor simply signs up.
 */
export async function GET(req: NextRequest) {
  const to = safeReturnPath(req.nextUrl.searchParams.get("to"));
  // Coming to buy: a new visitor gets the short sign-up (name, email, password, terms); otherwise the full talent form.
  const next = req.nextUrl.searchParams.get("next") === "login" ? "/login" : isBuyReturnPath(to) ? "/register/talent?quick=1" : "/register?as=talent";
  const res = NextResponse.redirect(new URL(next, req.url));
  res.headers.set("Cache-Control", "no-store");
  if (to) res.cookies.set(RETURN_COOKIE, to, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: RETURN_COOKIE_MAX_AGE });
  return res;
}
