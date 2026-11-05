# Buy flow and short sign-up: walkthrough

Plan: `docs/plan-buy-flow.md`.

## What a buyer sees

1. On a public course page, **Buy course** (or **Enrol for free**).
2. New visitor: the short sign-up with four fields (full name, email, password, terms). Existing account: log in. Either way the course is remembered in a cookie.
3. Verify the email (the existing gate). The dashboard then sends the buyer to **`/courses/<id>/buy`**. If the verification link is opened on another device the cookie is not there, and the buyer simply presses Buy course again.
4. The checkout screen shows the order, a "Have a promo code?" link, and the payments that are switched on: **Pay with Maya** (PHP courses), **Pay with PayPal** (PHP and USD courses), and **Pay by bank transfer or GCash instead**. A free course (or a code that makes it free) shows **Enrol for free**.
5. One press enrols and goes to the gateway. After paying, the buyer returns to the course; the payment is confirmed and the lessons open. Bank transfer and GCash enrol the learner and show the instructions on the course page; the lessons open when Hirewise records the payment (or an access code is entered).

If the Admin's welcome-video lock is on, a brand-new buyer first sees "Watch the welcome video first" with a button; checkout opens once it is watched, and the course page's Buy button returns to it.

## Notes

- The short sign-up creates the same talent account as the full form (duplicate check, terms record, referral attribution, email verification). Its profile is a draft with only a name and email, so nothing about it is visible to clients until the profile is completed and approved. The profile page asks for the rest.
- Someone already enrolled but unpaid sees their price (with any applied code) and the same payment buttons; someone who owns the course is redirected to it.
- If a payment cannot be started the learner keeps an unpaid enrolment and nothing is charged.
