# PayPal checkout: plan

Requested and approved 2026-11-04 (all six decisions as recommended). No migration.

## Why

The only online checkout was Maya (PHP only, off unless `MAYA_MODE` is set). A course page for any other case showed no Pay button, only the offline instructions and the access-code link. PayPal adds an online option for PHP and USD courses.

## How it works

PayPal Orders v2. Unlike Maya, approving does not take the money: the server must capture the approved order.

1. The learner presses Pay with PayPal on a pending enrolment. An `OnlinePayment` row (`provider = "PAYPAL"`) is created; its id is the reference sent to PayPal (`custom_id`), and the learner goes to PayPal's approval page.
2. PayPal returns the learner to `/courses/<id>?pay=success`.
3. The server captures the order (idempotent: `PayPal-Request-Id` is derived from the row id), then reads the order back from PayPal with the secret key.
4. `settleConfirmedPayment` checks amount, currency and reference against the enrolment and settles through `settleEnrollmentPaymentTx` (access, audit, referral commission, coach wallet earning).
5. The webhook and the worker's maintenance pass confirm the same payment later if the learner closed the tab.

Nothing is believed from the redirect or a webhook body. PayPal's own fee comes from the capture (`seller_receivable_breakdown.paypal_fee`), so the coach's earning is not left in `PENDING_FEE`; if PayPal reports no fee it waits for the real fee like a Maya sale.

## Decisions

1. Currencies: PayPal for PHP and USD courses; Maya stays PHP only. Both buttons show when both apply.
2. The access-code box stays as a collapsed "Have an access code?" link below the pay buttons.
3. Refunds: staff refund in PayPal, then record the refund in the app. A `PAYMENT.CAPTURE.REFUNDED` webhook raises a staff flag once and changes nothing by itself.
4. No migration: `OnlinePayment.provider` and `CoachEarning.channel` are plain strings.
5. Branch from `main`; the Public Academy part 2 work was committed on its own branch first.
6. Ships off (`PAYPAL_MODE` unset). Sandbox first, then production.

## Build

- `src/server/adapters/paypal.ts`: HTTP gateway and a local fake.
- `src/server/services/online-payment.service.ts`: the settlement both providers share (extracted from Maya's reconcile; Maya's behaviour and messages are unchanged).
- `src/server/services/paypal-payment.service.ts`: start, reconcile, return page, webhook, worker pass.
- `/api/webhooks/paypal`, `/api/payments/paypal-fake/[reference]`, `paypal-actions.ts`, `PayWithPayPal.tsx`, course page wiring, worker.
- Wallet and settlement channel type gains `"PAYPAL"`.
- Env: `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_WEBHOOK_STRICT`.
