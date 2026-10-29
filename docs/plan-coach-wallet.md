# Coach Wallet: findings and plan

Requested 2026-10-28. Nothing is built yet; this is the exploration and proposal asked for before any code.

## 1. What I found

### Courses and coaches
- Every course has one **owner coach** (`AcademyCourse.ownerCoachUserId`, required) and optional **co-coaches** (`CourseCoach`, many per course). So courses can be co-owned, but there is always exactly one owner.
- Courses made by staff are owned by that staff user (Admin and others, not only users with the Coach role).
- Coaches can already see their learners' progress (`learner.progress.read`), but there is no money view for coaches today.

### Payments, refunds, webhooks, gateway
- **Gateway: Maya Checkout** (PHP only). Stripe exists only for client invoices, not courses. PayMongo and Xendit are not used.
- A course sale is a `CourseEnrollment` that becomes paid in exactly one place, `settleEnrollmentPaymentTx`. It is reached from two directions: a verified Maya payment (`reconcileOnlinePayment`, triggered by Maya's webhook, the buyer's return to the course page, or the maintenance pass; the webhook body is never trusted, the payment is looked up at Maya) and staff recording a bank transfer or GCash payment (`recordCoursePayment`). Settlement is idempotent. That single point is the right and only place to create a coach earning, so earnings can never come from the checkout page.
- What the buyer actually paid is `CourseEnrollment.paidCents` (already after any promo code, since a code lowers `priceCents`). Waived enrolments, free courses, and 100%-off codes have no payment and would earn nothing.
- **Agency Course Seats** (`CoursePurchase`) are separate offline purchases recorded by staff; they also pay referral commissions.
- **Refunds** are a staff action after the money is returned in Maya (`recordCourseRefund`): REFUND or CHARGEBACK, **full only today** (there is no partial refund amount), it ends access and reverses the referral commission.
- Courses can be priced in PHP or USD; the platform's payout currency is PHP.

### Does Maya report the actual fee per transaction?
**I could not confirm that it does, and the evidence points to no.** The payment object the app reads, and Maya's documented webhook payload, carry id, status, amount, currency, fund source and timestamps but no fee. Maya's merchant terms say payments are credited "less the MDR" (the merchant discount rate, a percentage that is contractual and can change), which means the fee is netted out when Maya settles money to you. The per-payment fee appears in the **settlement report downloadable from Maya Business Manager**. I searched Maya's developer documentation and found no fee field or endpoint; I cannot test against your Maya account from here. This is the one real obstacle to "never estimate the fee".
- Staff-recorded bank and GCash payments have no gateway fee at all.

### The affiliate system
- `commission.service.ts`: a commission is created inside the same settlement transaction (`recordCommissionForPayment`), once per sale, rate locked on the row (15% of the amount paid, capped at the list price), held 30 days (`referrals.holdDays`), reversed on refund (`reverseCommissionForSource`), and paid through the payout queue (`payout.service.ts`) to an encrypted account (`PayoutDetails`, methods GCASH and BANK_TRANSFER).
- It is a separate liability today. The wallet rule (affiliate comes out of the platform share) needs no change to it: the wallet reads the commission created in the same transaction and records it on the earning.

### Existing pieces the wallet can reuse
Append-only tables with a database trigger (`AuditLog`, `AgencySeatLedger`), encrypted payout accounts (`encryptSecret`, `PayoutDetails`), a payout request, approve, mark-paid, reject queue (`Payout`), the maintenance pass that runs every few minutes and already releases commission holds, settings with typed defaults, and the audit and event conventions.

### Things that do not exist yet
No refund policy or refund-window setting exists (only the 30-day referral hold), no partial refunds, no fee storage, and no concept of a coach's money.

## 2. Proposed design

**Data (additive migrations; new tables need your approval per CLAUDE.md):**
- `CoachEarning`: one per enrolment (unique `enrollmentId`), coach, course, buyer, sale amount, gateway fee (nullable until known), net, the split rate in basis points locked at the sale, coach amount, platform amount, affiliate amount, currency, status (`PENDING_FEE`, `ON_HOLD`, `AVAILABLE`, `WITHDRAWN`, `REVERSED`), `availableAt`, `feeSource` (staff entry, settlement import, or later an API).
- `WalletLedgerEntry`: append-only (database trigger like `AgencySeatLedger`). Every balance change: earning, reversal, chargeback, withdrawal, manual adjustment; amount (signed), type, reference, note, created by. Balances are always computed from it.
- `CoachWithdrawal`: amount, method, status (`REQUESTED`, `APPROVED`, `PAID`, `REJECTED`), reference, rejection reason, timestamps. Account details reuse the existing encrypted `PayoutDetails` so a member has one payout account.
- `CoachShareOverride`: per-coach special rate with a note.
- New permissions: `coach.wallet` (Coach: own wallet) and `wallet.manage` (Admin and Super Admin: settings, overrides, adjustments, payout queue, reports). Setting `coachWallet` (coach share 6000 bps, refund window days, hold buffer days 7, minimum withdrawal 500.00, show buyer email off). Add `MAYA` as a payout method (additive enum value).

**Maths (a pure, unit-tested module like `promo.ts`):** net = sale - fee; coach = floor(net x rate); platform = net - coach (so parts always equal net); affiliate comes out of platform; platform keeps platform - affiliate. Override rate capped so the platform share can always cover the affiliate commission (around 84% at most; I propose a hard cap of 80%).

**Flow:** earning created in `settleEnrollmentPaymentTx` (idempotent); Maya sales start `PENDING_FEE` until the fee is entered or imported, then become `ON_HOLD` with `availableAt` = sale date + refund window + buffer (measured from the sale, so a late fee can go straight to available); the maintenance pass moves due earnings to `AVAILABLE` (idempotent, runs every few minutes, so it is at least daily). Refund while on hold reverses it and removes it; after withdrawal a negative ledger entry makes the balance negative and later earnings repay it first. The lost gateway fee on a refund is absorbed by the platform and logged. Withdrawals: only from available, only when at or above the minimum, one open request per coach, the amount locked while open.

**Screens:** Coach Wallet (balances, next release date, sales table with filters, expandable breakdown, CSV, payout details, withdraw, history; buyer shown as first name and last initial). Admin: payout queue, per-coach wallet with full ledger, manual adjustments with required note, platform revenue report, fee entry and settlement import, settings and overrides.

**Tests:** every case in your list, plus a three-way parts-add-up property test, coach-only data access, and idempotent settlement.

## 3. Decisions needed

1. **Where the real fee comes from (the blocker).** Recommended: staff enter the actual fee per Maya sale, or import Maya's Business Manager settlement report (CSV) matched by payment id or reference; earnings wait in `PENDING_FEE` until then; the app never estimates. In parallel, ask your Maya relationship manager whether Checkout can return fees per transaction, and we adopt it if so. Bank and GCash payments recorded by staff have no gateway fee (fee 0, no waiting). Alternative you ruled out: a fixed MDR percentage.
2. **Rounding conflict in your brief.** Rule 7 says round the coach share DOWN, but your worked example does not: 60% of 2,396.53 is 1,437.918, which rounds down to **1,437.91** (platform 958.62; with the referral the platform keeps 583.77), while your example shows 1,437.92 / 958.61 / 583.76 (nearest). I recommend rule 7 as written (floor) and I will use 1,437.91 / 958.62 / 583.77 in the tests; tell me if you meant nearest.
3. **Which sales earn:** self-purchased enrolments (Maya or staff-recorded) only; Agency Course Seat purchases excluded in v1 (recommended).
4. **Who earns on a co-owned course:** the owner coach gets the coach share; co-coaches get nothing automatically (recommended for v1; a per-course co-coach split can come later). Courses owned by staff who are not Coaches create no coach earning (the whole net stays with the platform).
5. **Refund window default:** no policy or setting exists; I recommend 14 days (your example), so earnings become withdrawable 21 days after the sale.
6. **Currency:** PHP only in v1; sales of USD-priced courses create no earning and are listed for staff to review (recommended).
7. **Partial refunds:** add an optional refund amount to the refund action (full stays the default) and reverse proportionally, including the coach's share and the affiliate commission (recommended).
8. **Withdrawals:** the coach withdraws the whole available balance each time (recommended, matches affiliate payouts); methods GCash, Maya, bank transfer.
9. **Buyer privacy:** first name and last initial; a setting can additionally show the buyer's email (default off); phone never shown.
10. **Platform-share floor:** cap per-coach overrides at 80% so the affiliate commission can always be paid from the platform share (recommended).

## 4. Rollout

One PR, built in this order: schema and split maths; earning creation and reversal inside settlement and refund; fee entry and import; hold release and withdrawals; coach and admin screens. Additive migrations only; no environment variables. Existing paid enrolments are not back-filled unless you ask (they predate the split rules).
