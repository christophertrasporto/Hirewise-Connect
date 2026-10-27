# Promo codes for courses

Built 2026-10-27 from `docs/plan-promo-codes.md` (all eight recommendations approved).

## What talent sees

- On a paid course page, "Have a promo code?" opens a box. Entering a code shows the new price before enrolling (`PHP 1,000.00` struck through, `PHP 800.00`) and the Enrol button carries it. An invalid code enrols nobody.
- On an unpaid enrolment the pending-payment banner shows the applied code with Remove code, or a box to add one. The Maya button and staff payment recording both use the discounted amount.
- A 100% code makes the enrolment free: the course unlocks at once, with no payment and no commission.

## What staff see (`promo.manage`: Admin and Super Admin)

Staff → Academy → **Promo codes** (`/staff/academy/promos`): create a code (a Generate button makes a readable one), edit everything except the name, Pause, Resume, Archive, and see who used it (learner, course, list price, discount, final price, status). The list shows used, remaining, paid versus reserved, and total discount given per currency. Staff → Academy → Payments shows list price and "promo code applied" next to the amount due.

A code has: a percentage or a fixed amount (with a currency), optional first and last day (Manila time, the last day is inclusive), total uses, uses per learner (default 1), a minimum course price, and all courses or selected courses.

## How it works

- **The price lives on the enrolment.** `CourseEnrollment.priceCents` is always the amount payable; `listPriceCents` keeps the price before a code. So Maya (`startMayaCheckout`), staff recording (`recordCoursePayment`), the Maya amount check (`reconcileOnlinePayment`), and the referral commission (the commission base is the paid amount capped at `priceCents`) all follow the discounted amount with no change to their logic.
- **Maths** (`src/lib/promo.ts`, pure and unit tested): percentage discounts round down to the centavo; an amount never exceeds the price; the final price is never negative; an amount code only applies in its currency.
- **Validity** (`evaluatePromo`): active, inside its dates, on a selected course, price at or above the minimum, under the total cap, under the per-learner cap. Every refusal reaches the learner as the same sentence ("This code isn't valid for this course."), and attempts are limited to 20 per hour per learner, so codes cannot be probed.
- **Uses** are counted from `PromoRedemption` rows, never stored. A use is `RESERVED` when applied, `CONSUMED` when the enrolment is paid or waived (inside `settleEnrollmentPaymentTx`), and `RELEASED` when the learner removes the code, replaces it, or leaves it unpaid longer than the `promos.reservationDays` setting (default 7; run by the maintenance pass). A refund keeps the use consumed. The cap is checked under a per-code advisory lock inside the transaction, so two learners cannot both take the last use; a partial unique index allows one live redemption per enrolment.
- **Open Maya attempts.** Changing the price cancels any open attempt locally (it was created for the old amount). If that checkout is paid anyway, the existing mismatch check flags it for staff and nothing is settled.
- **Audit and events.** `PROMO_CREATED`, `PROMO_UPDATED`, `PROMO_STATUS_CHANGED`, `PROMO_REDEEMED`, `PROMO_RELEASED`, each written in the same transaction as the change, with matching `PROMO_*` events (no notifications).

## Data

Migrations `20261027090000_promo_codes_schema` (enums `PromoDiscountType`, `PromoAppliesTo`, `PromoStatus`, `PromoRedemptionStatus`; tables `PromoCode`, `PromoCodeCourse`, `PromoRedemption`; column `CourseEnrollment.listPriceCents`) and `20261027090001_promo_codes_guards` (the partial unique index and CHECK constraints for code format, discount shape, limits, and redemption arithmetic). Additive only. New permission `promo.manage`; new setting `promos` (`reservationDays`). No new environment variables.

## Not included

Agency Course Seats (offline purchases recorded by Hirewise) and codes owned by a referrer that also credit that member. Staff can still waive or record a lower amount for a seat purchase as before.
