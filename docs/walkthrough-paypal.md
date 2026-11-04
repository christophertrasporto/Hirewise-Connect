# PayPal checkout: walkthrough

Plan: `docs/plan-paypal.md`.

## What a learner sees

On a course page with a pending payment, a **Pay <price> with PayPal** button (PHP and USD courses) beside **Pay with Maya** (PHP courses, when Maya is on). The bank transfer and GCash instructions stay, and "Have an access code?" is a small link under the buttons. After PayPal, the learner returns to the course; it is captured and confirmed on arrival, so the lessons are open at once. If they close the tab, the webhook or the worker confirms it within a few minutes.

## Going live (you enter every secret)

1. Business account, then developer.paypal.com, Apps & Credentials, Sandbox, Create App (Merchant).
2. Webhook on the app: `https://<your domain>/api/webhooks/paypal` for `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`. Copy its Webhook ID.
3. In Vercel, Environment Variables: `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`. Redeploy.
4. Pay for a course with a sandbox buyer account; confirm the lessons open and the payment shows as PAID.
5. Create a Live app and webhook, replace the four values with the live ones, set `PAYPAL_MODE=production`, redeploy.

`PAYPAL_MODE=fake` is a local stand-in (an in-app approval page) and is refused in production. Set `PAYPAL_WEBHOOK_STRICT=true` once webhooks are verified working, to reject unsigned ones.

## Refunds

Refund in PayPal, then record the refund in Staff, Academy, Payments as for any payment. A refund seen by the webhook raises a flag for Admin and Sales; it does not change anything by itself.

## Where things live

- Gateway: `src/server/adapters/paypal.ts`. Shared settlement: `online-payment.service.ts`. PayPal flow: `paypal-payment.service.ts`.
- Tests: `tests/unit/paypal.test.ts` (parsing, HTTP gateway, env) and `tests/integration/paypal-payments.test.ts`.
