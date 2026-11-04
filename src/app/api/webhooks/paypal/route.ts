import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { handlePayPalWebhook } from "@/server/services/paypal-payment.service";
import { RateLimitedError } from "@/server/auth/rate-limit";
import { logger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PayPal payment webhook. Register this URL in the PayPal developer dashboard (your app, Webhooks) for
 * CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, and PAYMENT.CAPTURE.REFUNDED, then put the
 * Webhook ID it shows in PAYPAL_WEBHOOK_ID. The service has PayPal verify the signature and confirms the order by lookup
 * before changing anything. A 2xx tells PayPal to stop retrying; a 5xx makes it retry.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || null;
  try {
    const r = await handlePayPalWebhook(prisma, {
      rawBody: raw,
      ip,
      headers: {
        transmissionId: req.headers.get("paypal-transmission-id"),
        transmissionTime: req.headers.get("paypal-transmission-time"),
        transmissionSig: req.headers.get("paypal-transmission-sig"),
        certUrl: req.headers.get("paypal-cert-url"),
        authAlgo: req.headers.get("paypal-auth-algo"),
      },
    });
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    if (e instanceof RateLimitedError) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    logger.error({ err: e instanceof Error ? { name: e.name, message: e.message } : e }, "paypal webhook failed");
    return NextResponse.json({ error: "Could not process the webhook" }, { status: 500 });
  }
}
