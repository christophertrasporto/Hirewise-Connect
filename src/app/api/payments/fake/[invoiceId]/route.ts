import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { getPaymentProvider } from "@/server/adapters/payments";
import { getEnv } from "@/server/env";
import { billingRepository } from "@/server/repositories/billing.repository";
import { recordProviderPayment } from "@/server/services/billing.service";

export const runtime = "nodejs";

/**
 * Local fake checkout (PAYMENT_PROVIDER=fake only, never in production): the signed-in
 * owning client "pays" the balance and is sent back to the invoice. Stands in for Stripe.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
  if (getPaymentProvider().name !== "fake" || getEnv().NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.redirect(new URL("/login", getEnv().APP_URL));
  const { invoiceId } = await ctx.params;
  const inv = await billingRepository.findInvoice(prisma, invoiceId);
  if (!inv || auth.actor.role !== "CLIENT" || auth.actor.clientId !== inv.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const balance = inv.amount - inv.payments.reduce((s, p) => s + p.amount, 0);
  const session = req.nextUrl.searchParams.get("session") ?? `fake_${inv.id}`;
  if (inv.status === "ISSUED" && balance > 0) {
    await recordProviderPayment(prisma, { invoiceId: inv.id, amount: balance, currency: inv.currency, reference: `${session}-${Date.now()}`, payload: { fake: true, session } });
  }
  return NextResponse.redirect(new URL(`/billing/invoices/${inv.id}?paid=1`, getEnv().APP_URL));
}
