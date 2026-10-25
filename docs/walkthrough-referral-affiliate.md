# Referral affiliate program

Built from `docs/plan-referral-affiliate.md`, approved 2026-10-25 with the recommended answer to all seven decisions: commissions hook into the existing staff payment confirmation, refunds get a staff action, commissions are in the sale currency (USD) with a 10.00 minimum, talent and agency owners earn, six-character codes, two new permissions, and no invented legal text.

## How it works

1. **Link.** Every talent and agency owner has one personal link, `/join?ref=MARIA-7K2QX9`, shown on Refer & Earn with a copy button. The code is the first name plus six random characters from an alphabet without 0, O, 1, I, and L. It is created the first time the member opens the page, so existing members need no backfill.
2. **Click.** `/join` is a route handler (agency invite links at `/join/[token]` are unchanged). A live code is logged as a `ReferralClick` (landing URL, user agent, IP stored only as an HMAC) and stored in a first-party cookie (`httpOnly`, `SameSite=Lax`, `Secure` in production) for `cookieDays`. Every link overwrites the cookie, so the last click wins. Unknown, malformed, suspended-referrer, and rate-limited codes continue to sign-up with no cookie and never block anyone.
3. **Sign-up.** Talent, client, agency-applicant, and agency-invite sign-ups read the cookie in the action and pass the code to the service, which attaches the referrer inside the registration transaction. `User.referredByUserId` and `referredAt` are write-once: the service only writes when null, and a database trigger rejects any later change, including clearing it. A check constraint forbids a user referring themselves.
4. **Commission.** When staff confirm a paid course enrolment (`recordCoursePayment`) or an agency Course Seat purchase (`recordCoursePurchase`), `recordCommissionForPayment` runs in the same transaction. It is idempotent per payment (unique on source type and source id, inserted with `ON CONFLICT DO NOTHING`), skips waived payments and buyers with no referrer, and stores the rate in force. Commission is `floor(base x rateBps / 10000)` in integer minor units where `base = min(paid, list price) - taxes - fees`. The commission starts `ON_HOLD` with `availableAt = paidAt + holdDays` and the referrer is notified.
5. **Hold to payable.** `releaseCommissionHolds` is part of `runMaintenance`, which the worker and the 5-minute cron tick already run. It is a single idempotent update, so it behaves as the daily job without a new scheduler.
6. **Refund or chargeback.** New staff actions record it on a paid enrolment (`recordCourseRefund`) or a paid seat purchase (`recordCoursePurchaseRefund`): payment status `REFUNDED`, access ends (seats of the purchase are revoked too), and the commission is reversed. If the commission was still unpaid it becomes `REVERSED`; if it was in an unpaid payout it leaves that payout and the payout shrinks (or is rejected when empty); if it was already paid out it becomes `REVERSED` and a negative `CommissionAdjustment` is recorded against the referrer's balance. A negative balance blocks payout requests until later earnings cover it.
7. **Payouts.** Members save payout details (GCash or bank transfer; the account number is AES-GCM encrypted with the same scheme as MFA secrets, shown masked, and never written to the audit log), then request a payout once the payable balance reaches the minimum. A request takes every payable commission and unsettled adjustment in one payout and is claim-checked so two simultaneous requests cannot double count. Staff approve, mark paid with a reference, or reject with a reason; rejecting releases everything back to the member.

## Fraud flags (flag, never block)

At attribution time the sign-up is compared with its referrer: the same mailbox after removing plus tags and Gmail dots (`EMAIL_ALIAS`), an IP address the referrer used in the last 90 days (`SAME_IP`, compared as hashes), and the same phone number (`SAME_PHONE`). Flags are stored with a short explanation and no raw IP, email, or phone of the other account, notify Admins, and appear on the affiliate page where staff mark them reviewed. The attribution itself still happens. Self-referral is the only hard block, at the data level.

## Pages

| Who | Page |
| --- | --- |
| Talent and agency owners | `/refer`: link and copy button, current rate, clicks, referred sign-ups, sales, on hold, payable, paid; commission history (buyer as first name and last initial only, course, price, rate, commission, status, date); payout details; request payout. |
| Staff with `referral.manage` | `/staff/referrals`: program settings (rate, hold days, cookie days, minimum payout, currency) and the affiliates list with flags. `/staff/referrals/[userId]`: balance, flags, the commission ledger with a manual Reverse, a signed Adjust balance form, payouts, and referred members. Every manual change needs a note and is audited. |
| Staff with `payout.manage` | `/staff/referrals/payouts`: queue by status with the account details staff need, Approve, Mark paid with a reference, Reject with a reason. |
| Staff with `course.payment.record` | `/staff/academy/payments`, "Recently paid": record a refund or chargeback. Seat purchases: Staff, Agencies, Seats and purchases, Course purchases, on paid rows. |

## Data model

New columns on `User`: `referralCode` (unique), `referredByUserId`, `referredAt`. New tables: `ReferralClick`, `Commission`, `CommissionAdjustment`, `Payout`, `PayoutDetails`, `ReferralFlag`. New enum values `REFUNDED` on `CoursePaymentStatus` and `CoursePurchaseStatus`, and refund fields on `CourseEnrollment` and `CoursePurchase`. Setting `referrals` (`commissionRateBps` 1500, `holdDays` 30, `cookieDays` 30, `minimumPayoutMinor` 1000, `payoutCurrency` USD). Permissions `referral.manage` and `payout.manage` (Admin and Super Admin).

## Where the rules are enforced

- Attribution: `attachReferrer` (service) plus the `user_referral_write_once` trigger and `User_referral_not_self` check (migration `referrals_guards`).
- Commission integrity: `Commission_buyer_not_referrer` and `Commission_amounts_valid` checks, the unique source, `createCommissionOnce`.
- Money: integer minor units everywhere; `commissionBase` and `commissionAmount` refuse floats.
- Privacy: `toCommissionMemberView` returns the buyer as first name and last initial and no ids or emails; staff views are separate.
- Permissions: member functions use `assertCanRefer` (talent and agency owners); staff functions authorize `referral.manage` or `payout.manage` first.

## Migration

`20261025090000_referrals_schema` (additive: columns, tables, enums, enum values) and `20261025090001_referrals_guards` (trigger and check constraints). Nothing is dropped and there is no data step. No new environment variables: the IP hash and the payout-details encryption reuse `AUTH_SECRET`, links use `APP_URL`, and the hold job uses the existing cron tick. Re-running the production foundation seed is optional: permissions are resolved from code at runtime, and the seed only mirrors the two new keys into the roles screen.

## Tests

`tests/unit/referral.test.ts` (12): code shape and alphabet, normalization, buyer privacy, masking, and the commission math with discounts, taxes, fees, the price cap, rounding, and rejected floats. `tests/integration/referral.test.ts` (32): codes and clicks, the `/join` cookie (30 days, last click wins, setting-driven length, invalid code still reaches sign-up), attribution for every sign-up type, once-only attribution including raw SQL rewrites, self-referral blocking, the three flags with no raw evidence stored, commission creation on confirmed payments, waived and unreferred sales, discount and tax math, rate locked at sale, idempotent and concurrent repeats, the seat purchase path with refund and seat revocation, hold to payable at the exact boundary and in the maintenance pass, refund before payout, after payout (negative adjustment, blocked payout), and while a payout is open, the payout lifecycle with a concurrent double request, the staff queue permissions, encrypted and masked payout details, member view privacy, permission refusals, and audited manual reverse and adjust.

## Not built

Online course checkout with coupons, taxes, and processor fees (the commission function already accepts them), card-sharing detection (no card data exists), automatic GCash or bank payouts, tiered or per-course rates, and program terms text (placeholder until counsel supplies it).
