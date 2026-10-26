import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { handleMayaWebhook } from "@/server/services/maya-payment.service";
import { RateLimitedError } from "@/server/auth/rate-limit";
import { logger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maya payment webhook. Register this URL in Maya Business Manager (Settings, Webhooks) for PAYMENT_SUCCESS,
 * PAYMENT_FAILED, PAYMENT_EXPIRED, and PAYMENT_CANCELLED. The service verifies the signature and confirms the payment
 * by lookup before changing anything. A 2xx tells Maya to stop retrying; a 5xx makes it retry (5, 15, 45 minutes).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || null;
  try {
    const r = await handleMayaWebhook(prisma, { rawBody: raw, signature: req.headers.get("x-maya-webhook-signature"), timestamp: req.headers.get("x-maya-webhook-timestamp"), ip });
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    if (e instanceof RateLimitedError) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    logger.error({ err: e instanceof Error ? { name: e.name, message: e.message } : e }, "maya webhook failed");
    return NextResponse.json({ error: "Could not process the webhook" }, { status: 500 });
  }
}
