# Referral affiliate program: findings and plan

Request received 2026-10-25 (referral link, 30-day cookie, lifetime 15% commission, hold and payout flow, member and admin pages, daily hold job). The request asks for exploration and a plan before any code, Approved 2026-10-25 and built; see docs/walkthrough-referral-affiliate.md.

## 1. What the codebase looks like

| Question | Answer |
| --- | --- |
| Stack | Next.js 15.5 App Router, React 19, TypeScript, Tailwind v4, Zod. Hosted on Vercel; a cron hits `/api/jobs/tick` every 5 minutes (outbox, jobs, housekeeping). |
| Database and ORM | PostgreSQL through Prisma 6 (Supabase in production, an embedded Postgres locally and in tests). Migrations in `prisma/migrations`, applied with `prisma migrate deploy`. |
| Layering | Services authorize first, write inside `db.$transaction` with `audit()` and `publishEvent()` in the same transaction; repositories are the only Prisma users; views are allow-lists. Tests: Vitest with a real Postgres, plus Playwright. |
| Users | `User` (email, role, status) with roles TALENT (`AGENT`), CLIENT, COACH, staff roles, and agency owners and managers. Names live on `AgentProfile`, `ClientContact`, and the agency record, not on `User`. Sign-ups: `registerAgent`, `registerClient`, `registerApplicant` (agency), and `registerViaInvite`. |
| Courses | `AcademyCourse` with `priceCents` and `currency` (USD today). Talent enrol themselves (`CourseEnrollment`: `priceCents`, `paidCents`, `paymentStatus` NOT_REQUIRED, PENDING, PAID, WAIVED). Agencies buy Course Seats (`CoursePurchase`: `amountMinor`, `currency`, status PENDING, PAID, WAIVED, CANCELLED). |
| Purchases and payments | **There is no online checkout for courses.** Talent and agencies pay Hirewise by bank transfer or GCash, and staff confirm it: `recordCoursePayment` (talent enrolment) and `recordCoursePurchase` (agency seats), each audited and publishing an event. |
| Payment provider | `src/server/adapters/payments.ts` has manual, fake, and Stripe providers, but the Stripe webhook (`/api/webhooks/stripe`) only records payments on **client invoices** (placement deposits). It is not used for courses. |
| Refunds, coupons, taxes, fees, cards | None exist. No refund or chargeback action, no discount or coupon, no tax or fee fields, and no card data stored anywhere. |
| Admin settings | `Setting` rows with typed defaults in `setting.service.ts` (`SETTING_SCHEMAS`), edited on `/staff/settings` by `settings.manage` (Super Admin only), audited with the previous value. |
| Money | Integer minor units plus an ISO currency everywhere (a project rule). |
| Background work | `runMaintenance` in `src/server/jobs/worker.ts` runs from the worker and from the cron tick; it is the home for idempotent housekeeping. |
| `/join` | Already used by agency invite links (`/join/[token]`). |

## 2. Where the request and the codebase differ

1. **No payment webhook for courses.** The only confirmed payment event for a course is the staff recording above. Commissions will be created in that same transaction through one function, `recordCommissionForPayment`, keyed on the payment source, so a future online checkout webhook calls the identical function.
2. **No discounts, taxes, fees, or refunds exist.** The commission base is the amount confirmed as paid (`paidCents` or `amountMinor`), capped at the list price, via a pure `commissionBase(paid, taxes, fees)` function so a future checkout with coupons plugs in. A refund or chargeback needs a new staff action (section 4, decision 2).
3. **Currency is USD, not PHP.** Prices and purchases are in USD cents. Commissions will keep the sale currency; the minimum payout is a setting in that currency.
4. **No card data**, so "shared payment card" cannot be flagged. The other three signals (email alias pattern, IP, phone) can.
5. **`/join?ref=` collides in spirit with agency invite links** (`/join/[token]`). A route handler at `/join` does not conflict technically.

## 3. Proposed build (one phase, one PR)

**Attribution.** `GET /join?ref=CODE` is a route handler: it validates the code, records a `ReferralClick` (referrer, landing URL, IP hash, user agent), sets a first-party cookie (`httpOnly`, `SameSite=Lax`, `Secure` in production, `cookieDays` from settings; last click overwrites), and redirects to `/register`. The sign-up actions read the cookie and pass the code to the services, which call `attachReferrer` inside the registration transaction. Attribution is set once: `referredByUserId` is written only when null, and a database trigger rejects any later change (the same approach as the append-only audit log). A user can never refer themselves.

**Codes.** `FIRSTNAME-XXXXXX`: a name prefix from the member's display name plus six random characters from an unambiguous alphabet (no 0, O, 1, I, L). Created at sign-up and lazily the first time an existing member opens Refer and Earn, so no backfill migration is needed. Clicks are rate limited.

**Commissions.** Created inside `recordCoursePayment` and `recordCoursePurchase` through `recordCommissionForPayment` when the buyer has a referrer, the sale is paid (not waived), and buyer is not the referrer. Unique on `(sourceType, sourceId)`, so a repeat call never duplicates. `commission = floor(base * rateBps / 10000)` in integer minor units; the rate in force is stored on the record. Status starts `ON_HOLD` with `availableAt = paidAt + holdDays`. The referrer is notified.

**Hold release.** `releaseCommissionHolds` in `runMaintenance` moves due `ON_HOLD` commissions to `PAYABLE` (idempotent, so running it every 5 minutes or daily is the same). It satisfies the daily job without a new scheduler.

**Refund or chargeback.** A new staff action records it on the enrolment or purchase and calls `reverseCommissionForSource`: an unpaid commission becomes `REVERSED`; one already `PAID` stays paid and a negative `CommissionAdjustment` is recorded against the referrer's balance. A negative balance blocks payout requests until it is cleared by later earnings.

**Fraud flags** (flag, never block, except the hard self-referral rule): same normalized email (plus tags and Gmail dots removed), same IP hash as one of the referrer's recent sessions, same phone, and an existing identity duplicate. Stored as `ReferralFlag` rows with evidence that never contains a raw IP or raw email of the other account.

**Payouts.** Members save payout details (GCash or bank transfer; the account number is encrypted with the same AES-GCM scheme as MFA secrets) and request a payout once the payable balance reaches the minimum. Staff approve, mark paid with a reference, or reject with a reason. Paying marks the included commissions `PAID`.

**Member pages.** `/refer` ("Refer and Earn"): link with a copy button, current rate, totals for clicks, referred sign-ups, sales, on hold, payable, and paid; commission history showing the buyer as first name and last initial only, the course, price, rate, commission, status, and date; payout details and the request button.

**Admin pages.** `/staff/referrals`: program settings (rate, hold days, cookie days, minimum payout), affiliates list (sign-ups, sales, balances, flags), payout queue, and manual reverse or adjust with a required note, all audited.

**Data model (adapted).** New tables, proposed per the project rule that new tables need a stated reason: `ReferralClick` (click log), `Commission` (the ledger of earnings, with the locked rate), `CommissionAdjustment` (negative adjustments and manual changes), `Payout` (payout requests and results), `PayoutDetails` (per-member payout method, encrypted), `ReferralFlag` (fraud evidence). New columns on `User`: `referralCode` (unique), `referredByUserId`, `referredAt`. New setting `referrals` (`commissionRateBps` 1500, `holdDays` 30, `cookieDays` 30, `minimumPayoutMinor`). New statuses: commission ON_HOLD, PAYABLE, PAID, REVERSED; payout REQUESTED, APPROVED, PAID, REJECTED; a REFUNDED payment status (decision 2). Migration is additive with no data step.

**Tests.** Last click wins; attribution never changes after sign-up (service and trigger); self-referral blocked at the data level and at commission time; flags for email alias, IP, and phone; commission math with discounts, taxes, and fees through `commissionBase`; the rate locked at sale after a setting change; idempotent creation on repeated payment recording; waived payments earn nothing; refund before payout reverses, refund after payout creates a negative adjustment; negative balance blocks payout; hold to payable at exactly `availableAt`; payout approve, pay, and reject; permissions (members cannot read others' commissions, staff-only pages); the member view never contains buyer full name, email, or ids.

## 4. Decisions to confirm

1. **Payment event**: hook commissions into the existing staff payment recording (recommended), and keep the function reusable for a future webhook. The alternative is to build online course checkout first, which is a larger separate phase.
2. **Refunds**: add a minimal staff "Record refund or chargeback" on talent enrolments and agency seat purchases, with a `REFUNDED` payment status that also ends the course access (recommended). Say if a refund should leave access in place.
3. **Currency**: commissions and the minimum payout in the sale currency, USD today, default minimum 10.00 USD (about 500 PHP); staff pay out in GCash or bank in PHP and note the amount in the payout reference (recommended). The alternative is to add PHP pricing to courses.
4. **Who earns and who counts**: every talent and agency owner account gets a link; sign-ups of any type are attributed; commissions apply to talent enrolments and agency seat purchases; clients and coaches do not earn (recommended). Or talent only.
5. **Code format**: six random characters after the name (about 700 million combinations) instead of the four in your example (recommended), created lazily.
6. **Permissions**: two new keys, `referral.manage` (settings, affiliates, adjustments) and `payout.manage` (payout queue), both on Admin and Super Admin, so Admins can change the rate as you asked (recommended); today only the Super Admin holds `settings.manage`.
7. **Legal text**: the program terms shown to members are a `LEGAL_PLACEHOLDER` until counsel supplies them (project rule: never invent legal text).

## 5. Out of scope

Automatic GCash or bank payouts (staff mark them paid), tiered or per-course rates, payment-card matching, two-level referrals, and email digests.

## 6. Rollout

Additive migration (no destructive step). No new environment variables: the IP hash and the payout-details encryption reuse `AUTH_SECRET`, and the hold job uses the existing cron tick. Production needs the migration applied (together with the pending skills migrations), which you run with `scripts/migrate-production.ps1`.
