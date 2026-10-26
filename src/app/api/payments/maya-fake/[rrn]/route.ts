import { NextResponse, type NextRequest } from "next/server";
import { getFakeMayaGateway } from "@/server/adapters/maya";
import { mayaEnabled } from "@/server/adapters/maya";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local stand-in for Maya's hosted checkout page (MAYA_MODE=fake only; never in production). Visiting it "pays" or
 * fails the checkout and redirects to the success, failure, or cancel URL, exactly like Maya would.
 * ?result=success (default) | fail | cancel
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ rrn: string }> }) {
  if (process.env.NODE_ENV === "production" || !mayaEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const fake = getFakeMayaGateway();
  const { rrn } = await ctx.params;
  const record = fake?.redirectsFor(rrn);
  if (!fake || !record) return NextResponse.json({ error: "Unknown checkout" }, { status: 404 });
  const result = req.nextUrl.searchParams.get("result") ?? "success";
  if (result === "fail") fake.setStatus(rrn, "PAYMENT_FAILED");
  else if (result === "cancel") fake.setStatus(rrn, "PAYMENT_CANCELLED");
  else fake.setStatus(rrn, "PAYMENT_SUCCESS");
  return NextResponse.redirect(result === "fail" ? record.failureUrl : result === "cancel" ? record.cancelUrl : record.successUrl);
}
