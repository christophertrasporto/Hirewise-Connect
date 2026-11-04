import { NextResponse, type NextRequest } from "next/server";
import { getFakePayPalGateway, paypalEnabled } from "@/server/adapters/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local stand-in for PayPal's approval page (PAYPAL_MODE=fake only; never in production). Visiting it approves or cancels
 * the order and redirects to the return or cancel URL, exactly like PayPal would. The money is only captured later, by
 * the server, when it reconciles the payment.
 * ?result=approve (default) | cancel
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ reference: string }> }) {
  if (process.env.NODE_ENV === "production" || !paypalEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const fake = getFakePayPalGateway();
  const { reference } = await ctx.params;
  const record = fake?.redirectsFor(reference);
  if (!fake || !record) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
  if (req.nextUrl.searchParams.get("result") === "cancel") return NextResponse.redirect(record.cancelUrl);
  fake.setState(reference, "APPROVED");
  return NextResponse.redirect(record.returnUrl);
}
