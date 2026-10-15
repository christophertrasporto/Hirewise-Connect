# Agency platform v2: Phase 2 plan, Agent Seats and the invite-link join flow

Phase 2 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec. It builds on Phase 1 (`docs/walkthrough-identity-phase1.md`) and absorbs the old A2 invite flow. Course Seats (training) stay separate and arrive with the credential-source work; nothing in this phase touches enrollments.

## 1. What exists and what this phase adds

| Area | Today | Phase 2 |
| --- | --- | --- |
| Plans | `Agency.planId` is an unused placeholder | `Plan` rows (Starter 5, Growth 20, Professional 50, Enterprise custom) with admin-edited prices and access flags; assigned at approval or by Admin |
| Seats | None. `AgencyUser` rows are Owner and Manager portal seats, unrelated to agent capacity | `AgencySeatLedger` (append-only, trigger-protected), computed totals, `SeatPackage`, `SeatPurchase`, `SeatRequest` |
| Joining an agency | Only an Admin override moves an agent's primary agency | Unique agency invitation link and email invites; sign-up or one-click join that consumes exactly one seat |
| Membership | `AgencyMembership {agentProfileId, agencyId?, isPrimary, status ACTIVE / ENDED}` enforced in the service only | Status machine `INVITED → PENDING_VERIFICATION → ACTIVE → (EXIT_REQUESTED / REMOVAL_REQUESTED → ENDING) → ENDED`, identity link, invitation source, seat ledger entry, ended-by; one open membership per platform identity enforced by a partial unique index |
| Portal | Team list read-only, seats placeholder | Overview tiles, My team with invites and membership status, Settings → Agent Seats (totals, history, request, buy) |
| Admin | Agency page with seats placeholder | Plans and packages, per-agency seat panel with reasons and override, seat request and purchase queues |

## 2. Schema (one additive migration, one data step)

- `Plan {id, key @unique, name, baseAgentSeats Int? (null = custom), priceMinor Int, currency Char(3), billingPeriod MONTHLY / ANNUAL, trainingAccess, opportunityAccess, features String[], isActive, sortOrder}`. Seeded with the four plans and prices of 0 marked "to be set by Hirewise"; nothing hardcoded in code.
- `SeatPackage {id, name, seatCount, priceMinor, currency, isActive, sortOrder}`. Seeded with three placeholder packages (5, 10, 25 seats) at price 0.
- `AgencySeatLedger {id, agencyId, changeType PLAN_BASE / PURCHASE / PROMO_GRANT / ADMIN_ADD / ADMIN_REMOVE / OVERRIDE / CONSUMED / RELEASED / PENDING_RELEASE, quantity Int (always positive; the type carries the direction), reason, relatedAgentProfileId?, relatedMembershipId?, seatPurchaseId?, planId?, effectiveAt, createdById?, createdAt}`. A database trigger rejects UPDATE and DELETE like `AuditLog`. Totals are always computed: base = PLAN_BASE, additional = PURCHASE, promo = PROMO_GRANT, adjustments = ADMIN_ADD + OVERRIDE − ADMIN_REMOVE, total = sum of those, used = CONSUMED − RELEASED, pending release = PENDING_RELEASE not yet RELEASED, available = total − used.
- `SeatPurchase {id, agencyId, packageId, seatCount, amountMinor, currency, status PENDING / PAID / WAIVED / CANCELLED, paymentReference?, paidAt?, recordedById?, ledgerEntryId?}`.
- `SeatRequest {id, agencyId, requestedSeats, note, status PENDING / APPROVED / REJECTED, reviewedById?, decisionNote?, grantedSeats?, ledgerEntryId?}`.
- `AgencyInviteLink {id, agencyId, token @unique, label, active, createdById, uses, expiresAt?}` and `AgencyEmailInvite {id, agencyId, email (citext), token @unique, status PENDING / ACCEPTED / REVOKED / EXPIRED, invitedById, expiresAt, acceptedMembershipId?}`.
- `AgencyMembership` gains `platformIdentityId`, `invitationSource UNIQUE_LINK / EMAIL_INVITE / ADMIN / OWNER`, `seatLedgerEntryId`, `endedById`, `invitedEmail`; `AgencyMembershipStatus` gains `INVITED, PENDING_VERIFICATION, EXIT_REQUESTED, REMOVAL_REQUESTED, ENDING`. Partial unique index: one membership per `platformIdentityId` in any open status. `isPrimary` stays true for all new rows (one agency at a time).
- `Agency` gains `plan Plan?` relation and `planStartedAt`. `AgencyApplication` gains `preferredPlanKey?` (decision 7).
- Settings `agencySeats {seatReleaseRule: "IMMEDIATE" | "AFTER_BILLING_PERIOD" | "AFTER_ASSIGNMENT_ENDS" (used from phase 3), inviteLinkTtlDays: 0 (no expiry), emailInviteTtlDays: 14, unverifiedJoinTtlDays: 14}`.
- Data step: plans and packages inserted; existing active memberships get `platformIdentityId` from their profile; null-agency "Hirewise Direct" membership rows are ended (decision 1).

## 3. Flows

- **Plan**: the application form offers a preferred plan; approval (or `createAgencyDirect`) assigns it and writes a `PLAN_BASE` entry for its base seats. Enterprise assigns no base seats; Admin adds them with a reason. Admin can change the plan later: the old base is reversed and the new base written, never below current usage without an override.
- **Invite link**: the owner generates or rotates the link under My team. `/join/[token]` (agency-facing only) shows "Join <agency name> on Hirewise Connect": for visitors, the talent sign-up form with the single terms checkbox; for signed-in Hirewise Direct talent, a one-click join. Both run duplicate detection (`INVITE_JOIN`), then, in one transaction: capacity check (available > 0 or refuse with "No Available Agent Seats"), user and identity and profile (`talentType AGENCY_AGENT`) or the existing profile, membership `PENDING_VERIFICATION` (or `ACTIVE` for verified existing talent), `primaryAgencyId`, one `CONSUMED` ledger entry linked to the membership, audit, events. Email verification moves `PENDING_VERIFICATION` to `ACTIVE`; a join unverified after `unverifiedJoinTtlDays` is ended by the worker and its seat released (decision 2).
- **Email invites**: the owner enters addresses; each gets a tokenised link by email. Open invites count against capacity so the agency cannot invite more people than it can seat (decision 3). Accepting goes through the same join path with `invitationSource EMAIL_INVITE`.
- **Exclusivity guard (minimum for this phase)**: a person with an open membership in another agency cannot join; the join page says so and the attempt is flagged with reason `ACTIVE_MEMBERSHIP`. The full exclusivity and exit rules are phase 3.
- **Seat requests**: owner submits a count and a note; Admin approves (writes `PROMO_GRANT` or `ADMIN_ADD` with the granted count and reason) or rejects; the owner is notified either way.
- **Seat packages**: owner picks a package → `SeatPurchase PENDING`; Admin records the payment (reference) or waives it → `PURCHASE` ledger entry; the owner sees pending and paid purchases with dates. The fake payment provider can "pay" a purchase in development; real checkout is left for the billing unification (decision 5).
- **Admin seat panel** on the staff agency page: add, remove, grant promo, override, with a required reason; removing below usage is refused unless the override box is ticked with a reason; agents are never removed automatically.
- **Portal**: Overview shows seats used, available, pending release, active agents; My team lists members with membership status and the invite tools; Settings → Agent Seats shows the plan, totals by source, the ledger history, "Request Additional Seats", and "Add More Seats".

## 4. Server

- `src/server/state/agency-membership.ts` (status machine), `seat.service.ts` (ledger math, capacity, admin changes, requests, purchases, plans and packages), `invite.service.ts` (links, email invites, join), repositories `seat.repository.ts`, `invite.repository.ts`, plan handling in `agency.repository.ts`.
- Permissions: `agency.plans.manage` (Super Admin, Admin), `agency.seats.manage` (Super Admin, Admin); portal `agency.seats.manage` for owners (request and buy seats), `agency.team.invite` (exists) for links and email invites. All agency reads and writes go through `assertAgencyScope` and `requireActiveAgency`.
- Audit: every ledger entry (`AGENCY_SEATS_CHANGED`), invite created, revoked, accepted, membership started and ended, request and purchase decisions. Events: `AGENCY_INVITE_SENT`, `AGENCY_MEMBER_JOINED`, `SEAT_REQUEST_SUBMITTED` (Admin task), `SEAT_REQUEST_DECIDED`, `SEAT_PURCHASE_RECORDED`, `AGENCY_SEATS_CHANGED`.
- Views: owner and staff seat views, member views (no identity keys; `FORBIDDEN_FOR_AGENCY` applies), public join page view (agency name and label only).

## 5. Tests

Ledger totals from mixed entries and the append-only trigger; capacity refusals at invite and at join (API, not UI); link join creates identity, profile, membership, exactly one `CONSUMED` entry with source, dates, and status; email invite join; existing talent one-click join; duplicate at join raises an `INVITE_JOIN` flag; a second open membership for the same identity is rejected by the database; unverified join expiry releases the seat; seat request and purchase flows with role checks; plan assignment and change; remove-below-usage refused without override; tenant scope on every read; owner versus manager permissions.

## 6. Decisions to confirm

1. **Hirewise Direct is the absence of a membership.** The null-agency membership rows from A1 are ended by the migration; `talentType HIREWISE_DIRECT` plus no open membership means direct talent.
2. **Seats are consumed at sign-up**, while the account is still `PENDING_VERIFICATION`. A join left unverified for 14 days (setting) is ended by the worker and the seat released.
3. **Open email invites reserve capacity.** An agency with 2 available seats can have at most 2 open invites. Link joins only count when they happen.
4. **The owner's own talent profile consumes a seat** like any agent (the D6 membership gets a `CONSUMED` entry in the data step if the agency has capacity, otherwise an Admin note).
5. **Pricing and payment**: prices live on `Plan` and `SeatPackage` rows, seeded at 0 and edited by Admin; purchases are recorded or waived by Admin, with the fake provider available in development only.
6. **Existing agencies have no plan** until Admin assigns one; the portal explains that invites open once a plan is set.
7. **Plan selection at application**: an optional preferred plan on the form, confirmed by Admin at approval.
