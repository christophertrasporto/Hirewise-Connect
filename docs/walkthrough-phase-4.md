# Phase 4 walkthrough — Commercial

Date: 2026-09-23. Implements MASTER_PROMPT.md Phase 4: billing rate proposal, approval, and publication with history; compensation records; the placement pipeline (Section 5.5) with every guard; deposit policies and deposit calculation; invoices with PDF; manual payment recording; service agreement acceptance or signed upload; deployment checklist; activation; client contract, invoice, and deposit pages; revenue and margin reports; `deposit.override` with reason.

## What was built

| Area | Where | Notes |
|---|---|---|
| Client billing rates | `rate.service.ts`, `/staff/commercial`, panel on `/staff/talent/[id]` | Sales proposes (`billing_rate.propose`) → PENDING_APPROVAL. Admin publishes or rejects (`billing_rate.approve`); publishing retires the previous published rate. Sales sees the published rate and proposals only, never history or positioning notes (Section 6 footnote 7). Clients see the PUBLISHED amount on candidate cards and profiles (INV-C3). Agents see a boolean "client rate published" only (INV-C2, Q4). |
| Agent compensation | `rate.service.ts`, confidential panel on `/staff/talent/[id]` | Separate table and permissions (INV-C1). `compensation.write` (Super Admin) sets a new record and ends the previous one; the agent reads their own; Admin reads only with a `compensation.read` override. |
| Rate history | `RateHistory` | One row per change on either table, written in the same transaction (INV-C4): propose, publish, supersede, reject, retire, compensation set. |
| Placement pipeline | `state/placement.ts`, `placement.service.ts`, `/staff/placements/[id]` | SELECTED → AWAITING_AGREEMENT (`placement.approve`, requires a PUBLISHED rate; snapshots rate and compensation refs, creates the deposit, issues the invoice) → AWAITING_DEPOSIT (client click-accept or staff signed-PDF upload) → DEPLOYMENT_PREP (system, when the deposit is PAID or WAIVED; seeds the checklist) → ACTIVE (`placement.activate`; required checklist done, start date set, deposit re-checked: INV-C5) ↔ PAUSED → COMPLETED; CANCELLED from any open state with a reason. Activation sets availability PLACED and converts the reservation; completion or cancellation restores availability. |
| Service agreement | `serviceAgreementFor`, `acceptServiceAgreement`, `recordSignedAgreement` | The PLACEMENT_SERVICE_AGREEMENT template carries `{{companyName}}`, `{{agentName}}`, `{{positionTitle}}`, `{{schedule}}`, `{{billingRate}}`, `{{deposit}}`, `{{startDate}}`. The rendered body is shown to the client, and its checksum is stored on the `AgreementAcceptance` with `placementId`, IP, and user agent (Q9). Staff can instead upload a signed PDF (`Document` kind SIGNED_AGREEMENT). |
| Deposits | `billing.service.ts`, `DepositPolicy`, `/staff/commercial/policies` | ONE_MONTH (default: rate × `hoursPerMonthDefault` for hourly, or the monthly rate), TWO_WEEKS, FIXED, PERCENTAGE, CUSTOM. Sales may recalculate an unpaid deposit with another policy (voids and re-issues the invoice). Waiving needs `deposit.override` and a reason and is audited (INV-C5). |
| Invoices and payments | `Invoice`, `Payment`, `/staff/commercial/invoices`, `/billing`, `/billing/invoices/[id]` | Numbered `HW-YYYY-NNNNN`. PDF rendered by a dependency-free writer (`adapters/pdf.ts`) into private storage and served by signed URL. Payments are recorded manually (`payment.record`) through the `PaymentProvider` seam (`ManualPaymentProvider`; Stripe is Phase 5, Q8). Partial payments leave the deposit PARTIALLY_PAID; a full payment settles it and advances the placement. Voiding needs a reason; paid invoices cannot be voided. |
| Client pages | `/placements/[id]`, `/billing` | Status stepper, rate snapshot, deposit, own invoices, agreement acceptance. Other clients' placements and invoices return 404 by direct URL. |
| Agent pages | `/placements/[id]` | Status, start date, checklist progress, own compensation snapshot, "client rate published" flag. No billing amounts, deposits, or invoices. |
| Reports | `report.service.ts`, `/staff/reports`, `/api/reports/{pipeline,revenue,margin}` (CSV) | Pipeline funnel (`report.pipeline`), billing-side revenue run-rate and collections (`report.revenue` + `billing_rate.read`), margin (additionally `compensation.read`; INV-C1). |
| Notifications | `events.ts`, `handlers.ts` | BILLING_RATE_PROPOSED/PUBLISHED/REJECTED, PLACEMENT_APPROVED, DEPOSIT_REQUIRED, DEPOSIT_PAID, CANDIDATE_DEPLOYED, PLACEMENT_STATUS_CHANGED. Agent-facing bodies carry no client financial terms (Section 9). Tasks: APPROVE_RATE (Admin), DEPLOY_AGENT (Operations). |
| Schema | migration `commercial_rates_deposits_invoices` | `ClientBillingRate`, `AgentCompensation`, `RateHistory`, `DepositPolicy`, `Deposit`, `Invoice`, `Payment`, `DeploymentChecklistItem`; `Placement` gains the snapshot refs, agreement fields, `pausedAt`. |

## Acceptance criteria (Section 13, Phase 4)

| Criterion | Evidence |
|---|---|
| `ACTIVE` unreachable with an unpaid deposit by any role, including Super Admin, without the override path | `tests/integration/commercial.test.ts`: activation throws `DepositUnpaidError` for Super Admin, Admin, and Operations; unit test proves AWAITING_DEPOSIT → DEPLOYMENT_PREP is system-only for every role. Waiving requires `deposit.override` and a reason. |
| Every rate change has a `RateHistory` row | Five rows after propose, publish, supersede, propose, publish; compensation changes add rows too. |
| Sales cannot publish a rate | `decideBillingRate` by Sales throws `ForbiddenError`; approval without a published rate is refused. |
| Margin report forbidden without `compensation.read` | Admin and Sales get `ForbiddenError`; Super Admin and an Admin with the override succeed; the revenue report never contains compensation keys. |
| Client sees only their own invoices by direct URL | `e2e/billing.spec.ts`: Acme opens its invoice; Beta gets 404 on the same URL and an empty billing page; the agent sees compensation but no billing amount. Integration test covers the same for `getInvoiceForClient` and `invoicePdfUrl`. |

## Demo script

1. `npm run db:seed` (adds deposit policies, published rates for Jose and Carlo, a pending proposal for Ana, and Carlo's ACTIVE placement at Acme Solar with a paid invoice).
2. **Admin** (`admin@hirewise.example`, MFA): Commercial → Rate approvals → publish Ana's proposal.
3. **Client** `hiring@acme-solar.example`: Interviews → select Jose (from Phase 2) so a placement exists at SELECTED. Or use the seeded flow below.
4. **Admin**: Placements → Jose's placement → Approve and issue deposit invoice (choose a policy). Client is notified.
5. **Client**: Placements → open → read the rendered agreement → Accept. Billing shows invoice `HW-2026-00002`, with the PDF and payment instructions.
6. **Sales** `sales@hirewise.example`: Commercial → Invoices → record the payment. The placement moves to Deployment prep and Operations gets a task.
7. **Operations** `ops@hirewise.example`: Placements → tick the checklist → set the start date → Activate. Jose becomes PLACED; client and agent are notified.
8. **Owner** `owner@hirewise.example`: Reports shows revenue, collections, and the margin table. Admin sees revenue but not margin.

## Known limits carried forward

- Payments are recorded manually; the `PaymentProvider` interface is the seam for Stripe (Phase 5).
- Invoice PDFs are single-page text renders; branding and line items can move to a layout engine without changing callers.
- Recurring monthly invoicing after activation is not generated automatically yet; the deposit invoice is the only automatic one.
- Sales sees placements for assigned clients only, as with shortlists and requirements; Admin and Operations see all.
- Do not run `next build` while the dev server is running: both write `.next` and the running server breaks until restarted.
