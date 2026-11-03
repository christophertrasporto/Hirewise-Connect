# Course access codes (until the payment gateway is live)

Requested 2026-11-03. Proposal only; nothing is built.

## The need
Maya is not available yet. A buyer pays by bank transfer or GCash, Hirewise confirms the money arrived, and the buyer must then be able to open the course. You asked for a code that does that.

## What exists today
1. **Staff record the payment** (Staff, Academy, Payments): the course opens at once, the coach earning and the referral commission are created. No code is involved, and it needs a staff member for every buyer.
2. **A promo code at 100% off** (Staff, Academy, Promo codes): create a code for one course, limit it to 1 use, give it to the buyer; they enter it on the course page and the course opens. It works today. The catch: the sale is recorded as a free course, so **the coach earns nothing and the referrer gets no commission**, and the books do not show that money came in.

## Proposal: an access code that records the payment
A staff member who has confirmed the payment generates a one-time code for that course. The buyer enters it and the course opens. Redeeming the code settles the enrolment through `settleEnrollmentPaymentTx` as a staff-recorded payment at the full price, so the audit entry, the coach wallet earning, the referral commission and the notification all happen exactly as if staff had recorded the payment by hand.

- **New table `AccessCode`** (needs your approval): code, course, optional buyer email it is meant for, the payment reference staff typed (bank or GCash reference), amount, status (UNUSED, REDEEMED, VOIDED), who made it, who redeemed it and when, expiry. Codes are stored as given but looked up case-insensitively; no other table changes.
- **Staff screen** (Staff, Academy, Access codes): generate (pick the course, optional buyer email, the payment reference), copy the code, see unused and used codes, void an unused one. Permission `course.payment.record` (Admin and Super Admin today), so no new permission.
- **Buyer side:** a "Have an access code?" box on the course page next to the promo box. If the buyer has no enrolment yet, redeeming creates it and settles it; if they already have a pending one, it settles that one. A promo code and an access code can both be used.
- **Safety:** one use only; tied to one course; if an email was set, only that account can redeem it; expires after 30 days by default; every refusal shows the same sentence (so codes cannot be probed); attempts are rate limited per account; the code is single-use even when two people try at the same moment.

## Decisions for you
1. Build the access code (recommended), or keep using a 100% promo code for now and accept that coach and referral earnings are not recorded for those sales.
2. Staff generate the codes; coaches do not (recommended).
3. Default expiry 30 days, editable per code.
4. Optional buyer email on each code (recommended, so a leaked code cannot be used by someone else).
5. Amount recorded is always the course price at the time (after any promo already applied); no partial payments.

## Rollout
One PR, one additive migration (one new table). I would run it on production only when you ask, and before merging, as with part 1. No new environment variables.
