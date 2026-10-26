# Maya online checkout for courses

Built from `docs/plan-maya-checkout.md`, approved 2026-10-26 with the recommended answer to all five decisions: courses priced in PHP, talent enrolments online first (agency Course Seats stay manual), Maya first and promo codes next, refunds recorded manually at first, and the Restore button for Freelancers Foundation in the same change.

## How it works

1. **Price in PHP.** A course has a price and a currency (PHP or USD). Enrolment snapshots the currency (`CourseEnrollment.currency`). New courses default to PHP; the old `priceUsd` field still means USD. Labels read `PHP 499.00` or `USD 49.00`. Changing only the currency counts as a price change in the audit log.
2. **Enrol, then pay.** A paid enrolment is created `PENDING` as before. On the course page a PHP course shows **Pay PHP 499.00 with Maya** next to the existing bank transfer and GCash instructions.
3. **Checkout.** `startMayaCheckout` (the learner's own pending enrolment only) creates an `OnlinePayment` row and a Maya checkout whose `requestReferenceNumber` is that row's id. It sends the learner to Maya's hosted page with success, failure, and cancel URLs back to the course page. A second click within 50 minutes resumes the same checkout.
4. **Confirmation is always by lookup.** `reconcileOnlinePayment` asks Maya for the payment by reference number with the secret key and settles only when Maya reports `PAYMENT_SUCCESS` (or `CAPTURED`) and the amount, currency, and reference match the enrolment. It runs from three places: the webhook, the course page when the learner comes back, and the maintenance pass (payments still open after two minutes, for up to 24 hours), so a lost webhook cannot strand a payment.
5. **Settlement.** A confirmed payment goes through `settleEnrollmentPaymentTx`, the same function staff use for offline payments: the enrolment becomes `PAID`, the audit entry and the learner notification are written, and the referral commission is created with its 30-day hold, all in one transaction. `paymentReference` is `MAYA:<maya payment id>`.
6. **Problems go to staff.** A payment with the wrong amount or currency becomes `MISMATCH` and is never settled. A payment that arrives after staff already recorded a bank transfer is kept and flagged. Both audit as `ONLINE_PAYMENT_PROBLEM` and notify Admin and Sales.
7. **Failures.** `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, and `PAYMENT_CANCELLED` leave the enrolment pending; the learner can try again (a new attempt is a new row).

## The webhook

`POST /api/webhooks/maya`. The signature (`X-Maya-Webhook-Signature`, RSA-SHA256, Maya's published public keys, 5-minute timestamp window) is checked as documented and the result is recorded on the payment. By default (`MAYA_WEBHOOK_STRICT=false`) a bad signature is logged and the payment is still confirmed by lookup, because the lookup, not the body, decides; a forged webhook therefore cannot unlock anything. Set `MAYA_WEBHOOK_STRICT=true` once you have seen `signatureValid = true` on real sandbox payments, to also reject bad signatures outright. The row is found from our reference number, from Maya's own id, or by asking Maya for the payment by id, because the documented example payload does not show the reference number. Only a short summary of the payload is stored, never the card details Maya includes.

## Configuration

| Variable | Meaning |
| --- | --- |
| `MAYA_MODE` | `off` (default: no button), `sandbox`, `production`, or `fake` (local stand-in, refused in production). |
| `MAYA_PUBLIC_KEY` | Public API key (`pk-...`), used to create checkouts. |
| `MAYA_SECRET_KEY` | Secret API key (`sk-...`), used to look payments up. Server only. |
| `MAYA_WEBHOOK_STRICT` | `true` rejects webhooks with a bad signature. Default `false`. |
| `MAYA_WEBHOOK_PUBLIC_KEY_1`, `_2` | Optional override of Maya's published webhook keys (write newlines as `\n`). The built-in keys are used when these are empty. |

Sandbox and production are separate in Maya: use each environment's own keys, and register the webhook URL (`https://<your domain>/api/webhooks/maya`) separately in Maya Business Manager, Settings, Webhooks, for `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, and `PAYMENT_CANCELLED`.

## Refunds

The staff refund action on the Payments page is still the system of record: it ends access and reverses the referral commission. Money is returned in Maya Business Manager (or through Maya's refund API once your Relationship Manager enables it); Maya's docs show no refund webhook, so staff record it here.

## Also in this change

- **Restore.** `restoreCourse` (Admin, `course.manage`) brings an archived course back to published when it has at least one published lesson. The Restore button is on the staff Academy page in the All courses table. Audited as `COURSE_RESTORED`.
- **Referral defaults** are now PHP with a 500.00 minimum payout (previously USD and 10.00), to match course prices and GCash payouts.

## Data model

One migration, `20261026090000_online_payments`, additive: `OnlinePayment` (provider, enrolment, checkout id, Maya payment id, amount, currency, status, signature result, short payload summary; unique per provider and checkout) with `OnlinePaymentStatus` (`CREATED`, `PENDING`, `PAID`, `FAILED`, `EXPIRED`, `CANCELLED`, `MISMATCH`), and `CourseEnrollment.currency` (default `USD`, which is correct for every existing row).

## Tests

`tests/unit/maya.test.ts` (11): the documented signature example reproduced exactly, flattening rules, header parsing, good and tampered signatures with both keys, nonce, body, and timestamp checks, Maya's four shipped keys are valid 2048-bit RSA keys, and the gateway's requests (public key for checkout, secret key for lookup, decimal amounts, hosts per environment, 404 handling, either status field name). `tests/integration/maya-payments.test.ts` (22): PHP pricing and currency changes, staff payment in the enrolment currency, checkout start and resume, every refusal, a failing gateway, settlement with notification and PHP commission, idempotent and concurrent confirmation, refund after a Maya payment, failed, expired, and cancelled attempts, mismatches and duplicates flagged, the return page, the maintenance pass, the webhook (signed, forged, strict, unsigned, stale, without a reference, unknown, malformed, Maya off), and Restore.

## Not built

Maya for agency Course Seat purchases (still manual), automatic refunds through Maya's API, and promo codes (next).
