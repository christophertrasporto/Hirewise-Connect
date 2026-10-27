# Promo codes for courses: findings and plan

Request 2026-10-25: "I want to be able to create promo code as well. Can it be done inside or I need third party platform?" Answer: inside. Maya Checkout only takes the amount we send it, so the discount has to be decided by us before the checkout is created. Nothing is built yet.

## 1. How a course is paid today

1. Talent enrols (`enrol` in `academy.service.ts`). The enrolment copies the course price and currency (`CourseEnrollment.priceCents`, `currency`) and is `PENDING` when the price is above zero.
2. The learner pays through Maya (`startMayaCheckout` sends `e.priceCents`), or staff records a bank or GCash payment (`recordCoursePayment` requires the amount to cover `e.priceCents`).
3. Both paths settle through `settleEnrollmentPaymentTx`, which unlocks the course, writes the audit row, and creates the referral commission from the paid amount (capped at `priceCents`).
4. `reconcileOnlinePayment` accepts a Maya payment only when Maya's amount, currency, and reference match `OnlinePayment.amountMinor` and `enrollment.priceCents`.

Consequence: if a code lowers the enrolment's own `priceCents` (and we keep the original price beside it), Maya, staff payment recording, the mismatch check, and the referral commission all follow the discounted amount with no change to their logic. That is the core of this plan.

## 2. Proposed design

**Data (additive migration, nothing dropped):**
- `PromoCode`: `code` (unique, upper-case), `label`, `discountType` (`PERCENT` or `AMOUNT`), `percentBps` or `amountMinor` + `currency`, `startsAt`, `endsAt`, `maxRedemptions` (optional), `perLearnerLimit` (default 1), `minPriceMinor` (optional), `appliesTo` (`ALL_COURSES` or `SELECTED_COURSES`), `status` (`ACTIVE`, `PAUSED`, `ARCHIVED`), `createdById`.
- `PromoCodeCourse`: the selected courses for a code.
- `PromoRedemption`: `promoCodeId`, `enrollmentId` (unique), `userId`, `listPriceMinor`, `discountMinor`, `finalMinor`, `currency`, `status` (`RESERVED`, `CONSUMED`, `RELEASED`), timestamps. Counts of use are always computed from these rows, never stored (same rule as seat totals).
- `CourseEnrollment.listPriceCents` (nullable): the price before any code. `priceCents` becomes the amount payable.

**Rules (one pure module, `src/lib/promo.ts`, plus `promo.service.ts`):**
- One code per enrolment. A code applies on the course page before enrolling (the code box sits next to Enrol) or to a pending enrolment (Apply or Remove).
- Percent codes round the discount down to the centavo; amount codes never exceed the price; the final price is never negative. Amount codes only apply to courses in their currency.
- A code is valid when it is active, inside its dates, under its redemption cap and per-learner limit, applies to that course, and the list price meets the minimum. Every refusal reads "This code isn't valid for this course", so codes cannot be guessed or enumerated; attempts are rate limited per user.
- A use is reserved when the code is applied, becomes consumed when the enrolment is paid, and is released when the learner removes it or when the enrolment is still unpaid after `promo.reservationDays` (default 7, run by the existing maintenance pass). The cap is checked under a lock inside the transaction so two learners cannot take the last use.
- Changing or removing a code on a pending enrolment cancels any open Maya attempt locally. If that old checkout is paid anyway, the existing mismatch check flags it for staff instead of settling it.
- 100% off: the enrolment needs no payment and unlocks at once; no Maya checkout, no commission.
- Agency Course Seats are not affected (offline purchases that Hirewise records).

**Screens:**
- Talent course page: "Have a promo code?" with the new price shown (`₱1,000` struck through, `₱800`, code name) and a Remove link.
- Staff → Academy → **Promo codes** (`/staff/academy/promos`): list with status, used and remaining, total discount given; create, edit (limits, dates, courses), pause, archive; per-code redemption list (learner, course, amounts, date).
- Staff payments page and the payment recorder show list price, code, and amount due.

**Permission and audit:** one new permission `promo.manage` (Admin and Super Admin). New audit actions `PROMO_CREATED`, `PROMO_UPDATED`, `PROMO_STATUS_CHANGED`, `PROMO_REDEEMED`, `PROMO_RELEASED`; redeeming and releasing are written in the same transaction as the enrolment change.

**Tests:** discount maths (rounding, caps, currency, minimum); validity (dates, status, cap, per-learner, scope, paused, archived); the last-use race; apply, change, and remove on a pending enrolment; Maya amount equals the discounted amount and a stale full-price payment is flagged; staff recording must cover the discounted amount; referral commission is on the discounted amount; 100% off unlocks without payment; a Forbidden test for every role without `promo.manage`; a learner cannot touch another learner's enrolment.

## 3. Decisions to confirm

1. **100% off codes**: allowed, unlock the course at once with no payment and no commission (recommended). Alternative: cap codes below 100% and use the existing staff Waive for free access.
2. **Who creates codes**: Admin and Super Admin (recommended). Alternative: add Sales.
3. **Codes and referral links together**: allowed; the commission is calculated on what the buyer actually paid (recommended). Alternative: a code switches the referral commission off.
4. **Agency Course Seats**: not included in this version (recommended).
5. **Holding a use**: reserved on apply, consumed when paid, released on removal or after 7 unpaid days; a refund keeps the use consumed (recommended).
6. **Per-learner limit**: one use per learner per code by default, adjustable per code (recommended).
7. **Discount rounding**: percentage discounts round down to the centavo (recommended).
8. **Referrer-owned codes** (a code that also credits a specific member, so influencers can share a code instead of a link): not in this version; it can sit on top of this later.

## 4. Rollout

One PR. One additive migration (three tables, two enums, one nullable column) applied with the usual `scripts/migrate-production.ps1` after merge, only when you ask. The new permission is part of the foundation seed; production gets it by re-running the foundation seed, or Super Admin always has it. No new environment variables. Existing enrolments are untouched.
