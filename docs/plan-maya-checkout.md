# Maya online checkout for courses: findings and plan

Request 2026-10-26: "I have a Maya Business account now, you can use it." Nothing is built yet. This plan also settles the earlier promo-code question, because Maya has no promo feature of its own.

## 1. What Maya offers (from the official docs at developers.maya.ph)

| Topic | Fact |
| --- | --- |
| Create a checkout | `POST /checkout/v1/checkouts` on `https://pg-sandbox.paymaya.com` (sandbox) or `https://pg.paymaya.com` (production). HTTP Basic with the **public** key as the username and an empty password. Required body fields: `totalAmount` (`value`, `currency`) and `requestReferenceNumber` (1 to 36 characters, unique). Optional: `buyer`, `items`, `redirectUrl` (`success`, `failure`, `cancel`), `metadata`. The response is `checkoutId` and a Maya-hosted `redirectUrl`. |
| Amounts and currency | Decimal major units (for example `"49.00"`), minimum 0.01. Every example is PHP. The docs do not say "PHP only" outright, so assume PHP until Maya confirms otherwise. |
| Final status | The docs say never to trust the redirect or the create response: "Always rely on Webhook events for final payment status." |
| Webhooks | `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `PAYMENT_CANCELLED` (the older `CHECKOUT_*` names are being retired). Registered in Maya Business Manager, Settings, Webhooks, or by API; separate for sandbox and production; HTTPS only. Retried up to four times at 5, 15, and 45 minutes, so handlers must be idempotent. No refund webhook was found. |
| Webhook security | Signed. `X-Maya-Webhook-Signature` (`nonce=...,v1=<hex>`) and `X-Maya-Webhook-Timestamp`. RSA-SHA256 against Maya's published public keys (two per environment), over the flattened, sorted `key=value` body plus the nonce. The docs recommend a 5-minute timestamp window and an IP allowlist. |
| Verify by lookup | `GET /payments/v1/payment-rrns/{requestReferenceNumber}` and `GET /payments/v1/payments/{id}` with the **secret** key return the payment and its status. |
| Refunds | Void (same day) and refund (from the next day, within 180 days, partial allowed) through Maya Business Manager or an API that "has to be enabled by your Maya Relationship Manager". The API path was not in the pages I could read. |
| Promos and vouchers | None. Promo codes must live in Hirewise Connect. |

Unconfirmed in the docs: the exact refund API path, whether `status` or `paymentStatus` is the webhook field (the pages disagree), and whether other currencies are accepted. I will check these against the sandbox before relying on them.

## 2. What I can and cannot do

I cannot sign in to your Maya account or see its keys. You enter the secrets yourself (project rule). I build the integration against the documented API and test it against Maya's sandbox with keys you put in your local `.env` and in Vercel. Two things need you in Maya Business Manager: copying the sandbox and later production keys, and registering the webhook URL after I tell you what it is.

## 3. Proposed build (one phase, one PR)

**Buying a course online.** A paid course shows a Pay with Maya button. It creates the enrolment as `PENDING` (as today), creates a Maya checkout with `requestReferenceNumber` set to the enrolment id and the redirect URLs back to the course page, and sends the learner to Maya.

**Confirming payment.** A new webhook route, `/api/webhooks/maya`, verifies the signature (both keys, timestamp window, optional IP allowlist), then looks the payment up by reference number with the secret key and checks that the amount, currency, and reference match the enrolment. Only then does it call the same payment-recording function staff use today, so the access unlock, the audit entry, and the referral commission with its hold all work exactly as now. It is idempotent: a retried webhook changes nothing.

**Keep manual payment.** Bank transfer and GCash recorded by staff stay available next to Maya.

**Failures.** Failed, cancelled, and expired payments leave the enrolment pending with a "Try again" button; nothing unlocks without a verified success.

**Refunds.** The staff refund action stays the system of record. If Maya enables the refund API for you, the action can send the refund to Maya as well; until then staff refund in Maya Business Manager and record it here, as the payments page already supports.

**Currency.** Courses are priced in USD today and Maya charges in PHP. See decision 1.

**Promo codes** (right after, same plan): internal codes, percent or fixed, all courses or chosen ones, usage limits and dates, applied before the Maya checkout is created, stored on the enrolment with the original price and discount. Referral commission already uses the amount actually paid, so it follows the discount.

**Settings and environment.** New: `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_ENV` (`sandbox` or `production`), and the two Maya webhook public keys as configuration. Maya is offered for course payments only when the keys are present; the existing client-invoice payment provider is untouched.

**Data model.** One table, `OnlinePayment` (provider, enrolment, checkout id, reference, amount, currency, status, timestamps, the raw verified payload), unique per provider and checkout id, so duplicate webhooks are harmless and there is a full trail. Promo codes add `PromoCode` and a few fields on `CourseEnrollment`. Both migrations are additive.

**Tests.** Signature verification (good, bad, replayed, stale timestamp), idempotent webhooks, amount or currency mismatch rejected, success unlocking the course and creating the commission, failed and expired payments, and promo math.

## 4. Decisions to confirm

1. **Currency**: price courses in PHP, matching Maya, GCash payouts, and your original ₱500 payout minimum (recommended). Each course gets its own currency, the labels follow it, and the referral payout currency becomes PHP. Existing USD prices such as Cold Calling 101 would need a PHP price. The alternative is to keep USD and convert at a fixed rate you set, which I do not recommend because the learner would pay an amount that does not match the price shown.
2. **Scope**: talent course enrolment online first; agency Course Seat purchases stay manual for now (recommended), because they are larger amounts that usually go by bank transfer.
3. **Order**: Maya checkout first, then promo codes (recommended).
4. **Refunds**: record manually at first, and add the Maya refund API call once your Relationship Manager enables it (recommended).
5. **Freelancers Foundation**: it is free, so it never touches Maya. The Restore button for it can ship in the same PR if you want it.

## 5. Rollout

Additive migrations, applied with `scripts/migrate-production.ps1`. Test in Maya's sandbox first with the documented test card, then switch the keys and register the production webhook. No change to existing orders or the client invoice flow.
