import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getPaymentProvider } from "@/server/adapters/payments";
import { recordProviderPayment } from "@/server/services/billing.service";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

/**
 * Stripe webhook (Phase 5). The provider adapter verifies the signature; only
 * checkout.session.completed with an invoice reference records a payment. Idempotent.
 */
export async function POST(req: NextRequest) {
  const provider = getPaymentProvider();
  if (provider.name !== "stripe") return NextResponse.json({ error: "Stripe is not the configured provider" }, { status: 404 });
  const raw = await req.text();
  let event;
  try {
    event = provider.parseWebhook(raw, req.headers.get("stripe-signature"));
  } catch (e) {
    logger.warn({ err: e }, "stripe webhook rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (event.type !== "checkout.session.completed" || !event.invoiceId || !event.amount || !event.currency) return NextResponse.json({ received: true, ignored: event.type });
  const result = await recordProviderPayment(prisma, { invoiceId: event.invoiceId, amount: event.amount, currency: event.currency, reference: event.reference ?? event.sessionId ?? `stripe-${Date.now()}`, payload: event.raw });
  return NextResponse.json({ received: true, ...result });
}
