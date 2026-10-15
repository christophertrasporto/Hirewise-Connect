# Agency platform v2: Phase 3 plan, exclusivity and exit

Phase 3 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec. It builds on phase 2 (`docs/walkthrough-agency-seats-phase2.md`): the membership status machine, `endMembershipTx`, the seat release rule setting, and the one-open-membership index already exist. Credential revocation (phase 4) and submission withdrawal (phase 5, submissions do not exist yet) are left as hooks on the exit event.

## 1. What exists and what this phase adds

| Area | Today | Phase 3 |
| --- | --- | --- |
| Exclusivity | One open membership per identity (database + `joinAgencyTx`); duplicate sign-ups flagged | A single `assertExclusive` guard used by every path that would give a member a second profile, a second agency, or an independent status; agent UI hides those actions while a membership is open |
| Leaving | Only an Admin override ends a membership | `ExitRequest`: Request to Leave (agent), Remove Agent (agency), owner review, Hirewise review when required, effective options, escalation when the owner does not respond |
| Exit actions | Seat released immediately, profile back to Hirewise Direct | Seat released per rule (immediate, end of billing period, end of assignment) with `PENDING_RELEASE` then `RELEASED`; profile becomes `FORMER_AGENCY_AGENT`, hidden from the marketplace, archived later; `AGENCY_EXIT_COMPLETED` event for the phase 4 and 5 handlers |
| Rejoin | Admin move keeps the same profile | `identity.rejoinCreatesFreshProfile` honoured: the former profile is archived and a fresh one created on the next join |

## 2. Schema (one additive migration)

- `ExitRequest {id, membershipId, agencyId, agentProfileId, platformIdentityId, type AGENT_REQUESTED_LEAVE / AGENCY_REQUESTED_REMOVAL, reason, effectiveOption IMMEDIATE / END_OF_ASSIGNMENT / END_OF_BILLING_PERIOD, requestedEffectiveDate?, status PENDING_AGENCY / PENDING_ADMIN / APPROVED / DECLINED / CANCELLED / COMPLETED, requestedById, agencyDecision? APPROVED / DECLINED, agencyDecidedById?, agencyDecisionNote?, agencyDecidedAt?, adminRequired, adminRequiredReason?, adminDecision?, adminDecidedById?, adminDecisionNote?, adminDecidedAt?, escalatedAt?, effectiveAt?, completedAt?, createdAt, updatedAt}`. One open request per membership (partial unique index).
- `AgencyMembership` gains `exitRequestId?`, `effectiveEndAt?`, `seatReleaseRule?`, `seatReleasedAt?`.
- `AgentProfileStatus.FORMER_AGENCY_AGENT` and `ARCHIVED` exist since phase 1; `AgentProfile` gains `formerAgencyId?` and `formerAt?` so the holding page and the identity history can say which agency the person left.
- Settings `agencyExit {ownerResponseDays: 5, adminReviewAlways: false, archiveAfterDays: 30}`; `agencySeats.seatReleaseRule` (phase 2) drives the release.

## 3. Flows

- **Request to Leave (agent)**: reason required, preferred effective option. Membership `ACTIVE → EXIT_REQUESTED`; the owner is notified. The agent can cancel before a decision. No "Leave" button anywhere.
- **Owner review**: approve (sets the final effective option and date) or decline with a note. Approval moves to Hirewise review when the agent has an active client assignment (any placement in a non-terminal status) or `adminReviewAlways` is on; otherwise it is final.
- **Remove Agent (agency)**: reason and effective option required. Membership `ACTIVE → REMOVAL_REQUESTED`; the agent is notified. Hirewise review is required under the same rule; otherwise the removal proceeds.
- **Hirewise review**: Admins see a queue (Staff → Agencies → Exit requests); approve or decline with a note; both sides are notified.
- **Escalation**: a request the owner has not answered within `ownerResponseDays` is escalated to Hirewise by the worker (status `PENDING_ADMIN`, `escalatedAt` set, Admin task).
- **Effective date**: IMMEDIATE ends now; END_OF_BILLING_PERIOD ends at the next period boundary from `planStartedAt` and the plan's billing period; END_OF_ASSIGNMENT ends when the agent's last open placement reaches a terminal status (the worker checks). Until then the membership is `ENDING` and counts as pending release.
- **Exit actions** (`completeExitTx`, atomic, audited, nothing deleted): membership `ENDED` with reason and ended-by; seat `PENDING_RELEASE` at approval and `RELEASED` when the release rule says so; profile `FORMER_AGENCY_AGENT`, availability `UNAVAILABLE`, hidden from search, `primaryAgencyId` cleared, `formerAgencyId` set; `AGENCY_EXIT_COMPLETED` published (phase 4 revokes agency-sponsored credentials, phase 5 withdraws pending submissions); the worker archives the former profile after `archiveAfterDays`.
- **Former agents**: keep their login; the dashboard shows a holding card ("You left <agency> on <date>. Independent reapplication opens in the next phase.") and no agency features.
- **Rejoin**: when a join finds the identity's current profile `FORMER_AGENCY_AGENT` or `ARCHIVED` and `rejoinCreatesFreshProfile` is on, the old profile is archived and a fresh one created with only the basics copied (professional name, location, timezone, primary role); credentials stay on the archived profile. With the setting off, the former profile is reactivated as `DRAFT`.
- **Admin override**: the existing direct move and end (`setAgentAgency`) remain and run the same exit actions.

## 4. Server

- `src/server/state/exit-request.ts` (status machine), `exit.service.ts` (request, cancel, owner decision, admin decision, escalation, completion, release scheduling, archiving), `exit.repository.ts`; `seat.service.endMembershipTx` becomes the single exit path with the release rule.
- Permissions: portal `agency.team.remove` (exists) for Remove Agent and exit decisions; staff `agency.manage` for Hirewise decisions; agents act through ownership of their own membership.
- Audit: `EXIT_REQUESTED`, `EXIT_CANCELLED`, `EXIT_AGENCY_DECIDED`, `EXIT_ESCALATED`, `EXIT_ADMIN_DECIDED`, `EXIT_COMPLETED`, `AGENCY_MEMBERSHIP_ENDED`, `AGENCY_SEATS_CHANGED`, `PROFILE_ARCHIVED`. Events: `EXIT_REQUESTED`, `EXIT_DECIDED`, `EXIT_ESCALATED`, `AGENCY_EXIT_COMPLETED`.
- Views: exit request views for agent, owner, and staff (no identity keys, no client details), former-agent holding view.

## 5. UI

- Agent: "My agency" card on the dashboard with "Request to Leave Agency" (reason, preferred timing), the pending request and its status, cancel; the holding card after leaving.
- Owner: My team → per member "Remove agent" (reason, effective option); "Exit requests" panel with approve or decline; pending removals and their effective dates; seats pending release on the seats card.
- Admin: Staff → Agencies → Exit requests queue with counts; decisions; the agency page and the identity history list exits.

## 6. Tests

Exclusivity guard on every path; Request to Leave → owner approve → immediate end with seat released and profile `FORMER_AGENCY_AGENT`; decline; cancel; Hirewise review required when a placement is open, decided both ways; Remove Agent with each effective option; billing-period and assignment-end releases through the worker; escalation after the owner window; former agent cannot join elsewhere until ended and then rejoins with a fresh profile (setting on) or the reactivated one (setting off); archive after the window; nothing deleted; role and tenant checks on every function.

## 7. Decisions to confirm

1. **Former profile**: `FORMER_AGENCY_AGENT` immediately at exit and archived by the worker after 30 days (setting), or at once when the person reapplies as independent in phase 4. The person keeps their login and sees a holding card until then.
2. **Active client assignment** means any placement for that agent in a non-terminal status (pending through paused).
3. **Owner silence**: 5 days (setting), then automatic escalation to Hirewise.
4. **Release timing**: end of billing period is computed from the plan's period and `planStartedAt`; end of assignment waits for the agent's last open placement to close. Both are recorded as `PENDING_RELEASE` then `RELEASED`.
5. **Fresh profile on rejoin** copies only professional name, location, timezone, and primary role.
6. **Admin override** stays and runs the same exit actions.
7. **Who sets the effective option**: the agent proposes; the owner (or Hirewise, when it decides) sets the final one.
