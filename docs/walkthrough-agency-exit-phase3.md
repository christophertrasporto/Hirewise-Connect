# Agency platform v2, phase 3: exclusivity and exit

Phase 3 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec (plan and the approved decisions 1 to 7: `docs/plan-agency-exit-phase3.md`). No membership ends unilaterally: agents request to leave, agencies request a removal, the agency and Hirewise decide, and every end runs the same exit actions.

## What changed

| Area | Delivered |
| --- | --- |
| Exit requests | `ExitRequest` with type (agent-requested leave, agency-requested removal), reason, effective option (immediate, end of assignment, end of billing period), the agency and Hirewise decisions with notes, escalation, effective and completion dates. One open request per membership (partial unique index). Status machine in `src/server/state/exit-request.ts`. |
| Request to Leave | Agent dashboard card "My agency" with "Request to Leave Agency" (reason, preferred timing); withdrawable before a decision. Membership `ACTIVE → EXIT_REQUESTED`. No "Leave" button exists. |
| Owner review | My team → Exit requests: approve (sets the final timing) or decline with a note. Approval goes to Hirewise when the agent has a placement in a non-terminal status (decision 2) or `agencyExit.adminReviewAlways` is on. |
| Remove Agent | My team → per member "Remove agent" (reason, timing). Membership `ACTIVE → REMOVAL_REQUESTED`; with no open assignment it is approved at once, otherwise it waits for Hirewise. |
| Hirewise review | Staff → Agencies → Exit requests: counts per status, approve or decline with a note (`agency.manage`). Owner silence beyond `agencyExit.ownerResponseDays` escalates automatically (decision 3). |
| Effective dates | Immediate ends now. End of billing period is the next boundary from `planStartedAt` and the plan's period (`nextBillingBoundary`). End of assignment waits for the agent's last open placement to close; the worker completes it. Until then the membership is `ENDING` and counts as pending release. |
| Exit actions | `completeExitTx`: membership `ENDED` with reason and ended-by; seat `RELEASED` now or `PENDING_RELEASE` per `agencySeats.seatReleaseRule`, released later by the worker; profile `FORMER_AGENCY_AGENT`, unavailable, hidden from the marketplace, `formerAgencyId` set; `AGENCY_EXIT_COMPLETED` event (phase 4 revokes agency-sponsored credentials, phase 5 withdraws pending submissions). Nothing is deleted. |
| Former agents | Keep their login; the dashboard shows the former-agent notice. The worker archives the profile after `agencyExit.archiveAfterDays` (decision 1); an archived-only account sees a holding page. |
| Rejoin | `identity.rejoinCreatesFreshProfile` (phase 1 setting) is honoured in `joinAgencyTx`: a former or archived profile is archived and a fresh profile is created with only professional name, location, timezone, primary role, and the private contact basics copied (decision 5); with the setting off the former profile is reactivated as `DRAFT`. |
| Admin override | `setAgentAgency` ends through `completeExitTx` (same exit actions, decision 6) and joins through `joinAgencyTx`, so an Admin transfer also produces a fresh profile when the setting is on. |

## Where the rules are enforced

- Exclusivity: one open membership per identity at the database; `joinAgencyTx` refuses a second agency; the former profile cannot request to leave or act as a member; the agent UI shows no agency-leaving or second-profile actions.
- Every write checks the actor: agents through their own membership, owners and managers through `agency.team.remove` and the agency scope, Hirewise through `agency.manage`. Cross-agency reads are `NotFound`.
- Seat accounting: `pendingRelease` counts memberships whose seat is still held after an exit (`seatReleasedAt` null, status `ENDING` or `ENDED`).

## Worker

`runMaintenance` now also escalates stale requests, completes due exits, releases held seats when the billing period or the assignments end, and archives former profiles.

## Migration

`20261015120000_agency_exit_schema` and `20261015120001_agency_exit_data` (one-open-request index; memberships ended before phase 3 are marked as released immediately). Settings `agencyExit {ownerResponseDays: 5, adminReviewAlways: false, archiveAfterDays: 30}`.

## Tests

`tests/integration/agency-exit.test.ts`: billing boundaries; request, notification, withdrawal; owner approval with immediate effect (seat released, profile former, audit and notifications); decline; Hirewise review when a placement is open with a billing-period end completed by the worker; escalation after owner silence and a Hirewise decline; agency removal with a held seat released by the worker after the billing period; removal with an open assignment completed when the placement closes; tenant scope and forbidden keys; the former agent rejoining with a fresh profile (setting on) or the reactivated one (setting off); archiving after the window; the Admin override producing a fresh profile on transfer. The A1 and phase 2 suites were updated for the former-profile semantics.

## Next

Phase 4: credential sources. Enrollments, certifications, and assessments get a source and sponsoring agency; the `AGENCY_EXIT_COMPLETED` handler revokes agency-sponsored items; eligibility counts active credentials only; independent reapplication creates the fresh profile.
