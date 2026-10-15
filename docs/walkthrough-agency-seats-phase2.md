# Agency platform v2, phase 2: Agent Seats and the invite-link join flow

Phase 2 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec (plan and the approved decisions 1 to 7: `docs/plan-agency-seats-phase2.md`). Agent Seats are an agency's membership capacity. Course Seats (training) are a different concept and arrive with the credential-source work.

## What changed

| Area | Delivered |
| --- | --- |
| Plans | `Plan` rows seeded as Starter (5), Growth (20), Professional (50), Enterprise (custom, no base seats). Prices and access flags are data, edited under Staff → Agencies → Plans and packages (`agency.plans.manage`), seeded at 0 and shown as "Price to be set" until Hirewise sets them. |
| Seat ledger | `AgencySeatLedger` is append-only (a trigger rejects UPDATE and DELETE, like the audit log). Totals are computed every time: base (current plan), additional (purchases), promo, adjustments, total, used (consumed minus released), pending release, available. Nothing stores a total. |
| Capacity | `assertCapacity` runs inside the join transaction; an invite or join that would exceed the available seats is refused with `SeatCapacityError` ("No Available Agent Seats"). Open email invites reserve capacity (decision 3). |
| Invitation link | One active link per agency (`/join/[token]`), rotatable; the page shows only the agency name and label. Visitors sign up with the normal talent form (terms checkbox, duplicate detection with kind `INVITE_JOIN`) and join in the same transaction as `PENDING_VERIFICATION`, taking one seat. Email verification activates the membership; an unverified join expires after `agencySeats.unverifiedJoinTtlDays` and releases its seat (decision 2). Signed-in Hirewise Direct talent joins with one click. |
| Email invites | Owner enters addresses; each gets a tokenised link (`agencyInvite` template) valid for `agencySeats.emailInviteTtlDays`; the invite must be used with the invited address; revoke frees the reservation. |
| Membership | `AgencyMembership` carries the platform identity, invitation source, seat ledger entry, ended-by. Status machine `INVITED → PENDING_VERIFICATION → ACTIVE → (EXIT_REQUESTED / REMOVAL_REQUESTED → ENDING) → ENDED` in `src/server/state/agency-membership.ts`; phase 3 drives the exit statuses. A partial unique index allows one open membership per platform identity. Hirewise Direct is the absence of an open membership (decision 1); the A1 null-agency rows were ended by the migration. |
| Seat requests and purchases | Owners request seats or buy a package (`agency.billing.manage`); Admins decide requests and record purchases as paid, waived, or cancelled (`agency.seats.manage`). Approvals and payments become ledger entries with reasons; tasks and notifications on both sides. |
| Admin seat panel | On the staff agency page: add, grant promo, remove, override, with a required reason. Removing below usage is refused unless the override box is ticked; agents are never removed automatically. Plan assignment reverses the old base (an `ADMIN_REMOVE` entry carrying the old plan id, so "base" always means the current plan) and seats any member who joined before the plan existed. |
| Portal | Overview tile "Agent Seats used / total"; My team lists members with membership status and source, the invitation link (copy, rotate), email invites; Settings → Membership plan and Agent Seats shows totals by source, the ledger history, Request Additional Seats, Add More Seats, and the plans when none is assigned. |
| Application | Optional preferred plan on the Apply for Agency form, shown on the review page and applied at approval (decision 7). Direct creation accepts a plan too. |

## Where the rules are enforced

- Capacity, one open membership per identity, and the seat consumption all happen in `joinAgencyTx` (`seat.service.ts`), inside the registration or join transaction, never only in the UI.
- Admin moves (`setAgentAgency`) release the old seat and take a new one; they are allowed over capacity because they are deliberate overrides, and the agency shows as over capacity until seats are added.
- Agency reads go through `scopedAgencyId` / `assertAgencyScope`; every owner-facing view is checked against `FORBIDDEN_FOR_AGENCY`.
- Settings `agencySeats`: `seatReleaseRule` (used by phase 3), `inviteLinkTtlDays` (0 = no expiry), `emailInviteTtlDays`, `unverifiedJoinTtlDays`.

## Migration and seed

`20261015090000_agency_seats_schema` (tables, columns, enum values) and `20261015090001_agency_seats_data` (ledger trigger, membership identity backfill, ending of null-agency rows, one-open-membership index, plans and packages). The foundation seed upserts the same plans and packages. Existing agencies have no plan until an Admin assigns one (decision 6); their portal explains that invites open after that.

## Tests

`tests/integration/agency-seats.test.ts`: ledger arithmetic and the append-only trigger; plans and packages permissions and pricing; the public join page and its allow-list; sign-up through the link with exactly one seat, email verification activating the membership and notifying the owner; duplicate sign-ups flagged as `INVITE_JOIN`; one-click join for existing talent and the database refusing a second open membership; link rotation; capacity refusals at join and invite; email invites reserving capacity, address matching, revoke, acceptance; expiry of unverified joins releasing the seat; seat requests and purchases with role checks and notifications; removal below usage and override; plan changes including Enterprise; Admin moves releasing and taking seats; tenant scope and forbidden keys. The A1 suite was updated for the new membership semantics.

## Next

Phase 3: exclusivity and exit. The membership status machine, the seat release rule, and `endMembershipTx` are in place; phase 3 adds Request to Leave, Remove Agent, the Hirewise approval rules, and the exit actions.
