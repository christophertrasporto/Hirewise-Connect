/**
 * Payment provider behind an interface (Section 8.6, ASSUMPTION A5).
 * Phase 4 ships the manual provider only: staff record bank transfers and other
 * offline payments against invoices. A Stripe adapter (Phase 5) implements the
 * same interface and returns a hosted checkout URL.
 */
export type CheckoutRequest = { invoiceId: string; number: string; amount: number; currency: string; description: string; clientEmail: string | null };

export interface PaymentProvider {
  readonly name: "manual" | "stripe";
  /** Hosted checkout for online payment, or null when the provider has none. */
  createCheckout(req: CheckoutRequest): Promise<{ url: string } | null>;
  /** Instructions shown to the client on an unpaid invoice. */
  paymentInstructions(): string;
}

export class ManualPaymentProvider implements PaymentProvider {
  readonly name = "manual" as const;
  async createCheckout(): Promise<null> {
    return null;
  }
  paymentInstructions() {
    return "Pay by bank transfer or PayPal using the invoice number as the reference. Your account manager records the payment, usually within one business day.";
  }
}

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!provider) provider = new ManualPaymentProvider();
  return provider;
}

export function setPaymentProviderForTests(p: PaymentProvider | null) {
  provider = p;
}
