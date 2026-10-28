import { NextResponse, type NextRequest } from "next/server";
import { RETURN_COOKIE, safeReturnPath } from "@/lib/return-to";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Used once, by the dashboard, after every sign-in gate has passed: go to the remembered course and forget it. The cookie
 * is validated again here, so a tampered value only ever lands on the dashboard.
 */
export async function GET(req: NextRequest) {
  const to = safeReturnPath(req.cookies.get(RETURN_COOKIE)?.value);
  const res = NextResponse.redirect(new URL(to ?? "/dashboard", req.url));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete(RETURN_COOKIE);
  return res;
}
