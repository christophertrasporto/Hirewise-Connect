# Coach Wallet

Built 2026-10-28 from `docs/plan-coach-wallet.md` (all ten recommendations approved).

## What a coach sees (`/wallet`, Coach role)

- **Balance:** On hold, Available to withdraw (the whole available balance is withdrawn each time), Withdrawn all time, and the date the next on-hold amount becomes available. A line appears when online sales are waiting for their gateway fee.
- **Sales table:** date, buyer, course, sale price, gateway fee, your earning, status, and the date it becomes available. Filter by course and date range; Download CSV exports the same rows. Open "How this was calculated" on any sale to see price minus fee equals net, then the coach share (rounded down) and Hirewise's share.
- **Buyer privacy:** first name and last initial only. Staff can switch on the buyer's email in Settings (off by default); a phone number is never shown. The referral commission, the buyer's account id, and who referred them are never in a coach view.
- **Payout details:** GCash, Maya, or bank transfer; stored encrypted (the same single payout account the referral program uses), only the last four digits are shown back.
- **Withdraw and history:** requests need payout details and the minimum; one open request per coach; each shows its status, reference, or the reason it was declined.

## How an earning is worked out

Per sale: **sale amount** (what the buyer actually paid, after any promo code) minus the **actual gateway fee** equals the **net**. The coach gets floor(net x share) and the platform gets the rest, so the two always add up to the net exactly and any leftover centavo goes to the platform. The **referral commission** (15% of the sale, from the existing affiliate system) is paid out of the platform share and never reduces the coach's.

Worked example, rule 7 as written (the brief's example rounded the coach share to nearest; this rounds down): sale 2,499.00, fee 102.47, net 2,396.53, coach 1,437.91, platform 958.62. With a referral: affiliate 374.85, platform keeps 583.77, coach still 1,437.91.

The split rate, the hold dates, and the affiliate amount are stored on each earning when the sale is confirmed. Changing a setting or a coach's special rate affects new sales only.

## Where the real gateway fee comes from

Maya's payment data and webhook do not carry a per-transaction fee that I could find (Maya nets its fee out when it settles to you, and the per-payment fee is in the settlement report downloadable from Maya Business Manager). So the app **never estimates it**:

- An online (Maya) sale is created **PENDING_FEE**: nothing is credited and the coach sees "waiting for the gateway fee".
- Staff (`wallet.manage`) record the exact fee under **Coach wallets, Gateway fees**: one sale at a time, or **import the Maya settlement report (CSV)**. Rows are matched by Maya payment id, our request reference number, or the enrolment id; the header row must have a reference column (Payment ID, Reference, RRN, ...) and a fee column (Fee, MDR, ...). I could not verify Maya's exact report columns, so the importer matches header names loosely and reports what it could not use; if your report differs, the one-at-a-time entry always works.
- Once the fee is recorded the earning is created in the ledger and goes on hold (or straight to available if its hold has already passed). The fee can be set once.
- Sales recorded by staff (bank transfer, GCash) have no gateway fee: zero by default, or the amount staff enter when recording the payment (`gatewayFee`), and go straight on hold.
- If Maya ever reports the fee through its API, the same entry point can take it (`GATEWAY_API` is already a fee source).

If you can get Maya to include fees per transaction (ask your relationship manager), tell me and the importer becomes automatic.

## Hold, available, withdrawals

- A new earning is **on hold** until the sale date plus the **refund window** (default 14 days) plus the **extra hold** (default 7), then **available**. The maintenance pass (every few minutes) moves due earnings; it is idempotent.
- **Available = ledger total minus what is still on hold.** The wallet balance is never stored: it is the sum of the append-only ledger (a database trigger rejects updates and deletes). Because of that rule a negative balance after a post-withdrawal refund repays itself from later earnings with no special handling, and nothing new becomes withdrawable until the debt is cleared.
- **Withdrawing** takes the whole available balance, only at or above the minimum (default 500.00), with payout details on file, and never while another request is open. The amount leaves the ledger the moment it is requested (so it cannot be requested twice; a partial unique index also enforces one open request per coach). Staff approve, mark paid with a reference, or reject with a reason (a rejection puts the money back). Marking paid flags the earnings it covered as withdrawn.

## Refunds and chargebacks

Staff record them as before (Staff, Academy, Payments); the refund form now takes an optional **amount** for a partial refund.

- **Before the coach withdrew:** the earning is reversed (or reduced in proportion) and leaves the wallet. A refund of a sale still waiting for its fee reverses it with nothing to take out.
- **After withdrawal:** a negative ledger entry (`REFUND_AFTER_WITHDRAWAL`); the balance can go negative.
- **The gateway fee is not returned**, so the platform absorbs its share; the coach's earning is reversed in full on the refunded part. The absorbed amount is recorded on the earning, in the audit log, and in the revenue report.
- **Partial refunds** are proportional (rounded down, cumulative, never more than the whole): the learner keeps access, the coach share is reduced, and the referral commission is reduced by the same proportion (a signed adjustment; a later full refund removes only what is left). A partial refund is refused while the sale's fee is still unknown.

## Admin (`wallet.manage`: Admin, Super Admin) under Coach wallets

Withdrawals (queue with the full account number and the decision forms), Gateway fees (pending list, one-at-a-time entry, CSV import), Coaches (balances, special-rate flag, then per coach: full ledger, sales with the complete breakdown including affiliate and absorbed fees, manual adjustment with a required note, special rate), Revenue report (total sales, gateway fees, coach payouts, affiliate payouts, platform net, by date range and by coach), and Settings (coach share, refund window, extra hold, minimum withdrawal, show buyer email).

## Rules and limits chosen

Only self-purchased enrolments paid in PHP earn: waived, free, 100%-off, USD-priced, and Agency Course Seat purchases do not. Only the course's owner coach earns (co-coaches do not share, yet); a course owned by a staff user who is not a Coach earns nothing for anyone, the platform keeps the net. A special rate and the global share are capped at 80% so the platform share can always cover the 15% commission. Payments made before this release have no earning (nothing is back-filled).

## Data

Migrations `20261028090000_coach_wallet_schema` (tables `CoachEarning`, `WalletLedgerEntry`, `CoachWithdrawal`, `CoachShareOverride`; enums for status, fee source, ledger type, withdrawal status; `PayoutMethodKind` gains `MAYA`; `CourseEnrollment.refundedCents`) and `20261028090001_coach_wallet_guards` (the append-only trigger, one open withdrawal per coach, CHECK constraints that the split always adds up and statuses match amounts). Permissions `coach.wallet` (Coach) and `wallet.manage` (Admin, Super Admin). Setting `coachWallet`. No new environment variables.
