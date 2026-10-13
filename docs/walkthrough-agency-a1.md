# Agency marketplace, phase A1: foundation

Partner agencies run their own teams inside Hirewise Connect while Hirewise keeps every client relationship. Phase A1 delivers the gated onboarding and the tenant boundary that every later phase builds on. Phases A2 to A6 (team invites, training marketplace, opportunities and eligibility, submissions and placements, reporting) follow in `docs/decisions.md`.

## The rules this phase enforces

| Rule | Where it is enforced |
| --- | --- |
| Agency creation is application-only | `Agency` rows are created in exactly two functions: `createAgencyForApplication` (called only inside `approveApplication`, which needs `agency.review`) and `createAgencyDirect` (`agency.create_direct`, Super Admin only). No server action or route exposes anything else; `tests/integration/agency-foundation.test.ts` proves a staff, owner, or talent call is refused. |
| Owner role only on approval | Approval adds the Owner seat (`AgencyUser`) and, for an account that was an `APPLICANT`, switches the role to `AGENCY_OWNER`. Talent and client accounts keep their role; the seat alone grants the portal (decision D1). |
| Applicants have no agency features | `APPLICANT`, `AGENCY_OWNER`, and `AGENCY_MANAGER` hold no catalog permissions. Portal capabilities (`agency.*` in the `agency-portal` group) are resolved onto the `Actor` from the seat: owners get all, managers the subset the owner picks. |
| Data separation | `Actor.agency` is the tenant scope. Agency reads go through `assertAgencyScope` / `scopedAgencyId`; anything outside the actor's agency is `NotFound`, never `Forbidden`. Staff with `agency.read` / `agency.manage` see everything. |
| Suspended agencies keep data, lose writes | `requireActiveAgency` guards every portal write; the seat stays, so reads work; `Agency.status` transitions need `agency.manage` and a reason. |
| Agreements recorded with context | Applying records an `AgreementAcceptance` of `AGENCY_NON_CIRCUMVENTION` with `context = AGENCY_APPLICATION`, the application id, checksum, IP, and user agent (INV-I2 kept). `SUBMISSION_TERMS` is seeded for phase A5. |
| Every decision audited | Audit actions `AGENCY_APPLICATION_*`, `AGENCY_CREATED`, `AGENCY_SUSPENDED`, `AGENCY_REACTIVATED`, `AGENCY_DEACTIVATED`, `AGENCY_SEAT_ADDED`, `AGENCY_MEMBERSHIP_STARTED/ENDED`, plus `AgencyApplicationHistory` rows per status change. |
| Nothing hardcoded | Setting `agencyApplications`: re-application cooldown (default 30 days, reviewer may override per rejection), document count and size limits, review due days. Editable under Staff → Settings. |

## Schema (migration `20261013090000_agency_foundation`)

`AgencyApplication` (+ `AgencyApplicationHistory`), `Agency`, `AgencyUser` (Owner / Manager seats), `AgencyMembership` (agent membership history; `agencyId` null = Hirewise Direct), `AgentProfile.primaryAgencyId`, `AgreementAcceptance.context/applicationId/submissionId`, enum additions on `RoleKey`, `AgreementType`, `DocumentOwnerType`. All additive; no existing row changes.

## Flows

- **Apply**: `/register/agency` creates an `APPLICANT` account (email verification gate applies), or any signed-in talent / client opens `/apply/agency` from the dashboard menu. One application in flight per user; editable while `SUBMITTED` or `NEEDS_MORE_INFO`; documents upload straight to storage under `agency-applications/<id>/` and stream back through `/api/agency/documents/[id]` after an owner / reviewer check; withdraw at any open status.
- **Review**: Staff → Agencies → Applications: counts per status, average review time, filters (status, country, dates, search). Review screen: full application, documents, history, internal notes (never shown to the applicant), Start review, Request more info (message required), Approve (optional welcome message), Reject (reason required, cooldown override). Submission opens a `REVIEW_AGENCY_APPLICATION` task in the Admin queue and notifies Admins; decisions notify the applicant in-app and by email.
- **Agency portal** (`/agency`, "My agency" in the menu for seat holders): Overview, My team (agents whose primary agency is this one), Training / Opportunities / Reports placeholders for A3 to A6, Settings (profile form, seats, billing placeholder). Suspended or inactive agencies see the reason and read-only pages.
- **Staff agency page** (`/staff/agencies/[id]`): profile, seats, agents with an admin override of each agent's primary agency, status changes with reasons.

## State machines

`src/server/state/agency-application.ts`: `SUBMITTED → UNDER_REVIEW | NEEDS_MORE_INFO | APPROVED | REJECTED | WITHDRAWN`, `UNDER_REVIEW → NEEDS_MORE_INFO | APPROVED | REJECTED | WITHDRAWN`, `NEEDS_MORE_INFO → SUBMITTED (applicant) | WITHDRAWN | REJECTED`. Agency: `ACTIVE ↔ SUSPENDED`, `ACTIVE | SUSPENDED → INACTIVE`, `INACTIVE → ACTIVE`, all with `agency.manage` and a reason.

## Permission matrix (A1 scope)

| Action | Super Admin | Admin | Sales / Recruiter | Applicant | Agency Owner | Agency Manager | Agent | Client |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Submit, edit, withdraw own application | ✓ (refused: staff) | refused | refused | ✓ | — | — | ✓ | ✓ |
| Review queue, request info, approve, reject | ✓ | ✓ | read only | — | — | — | — | — |
| Create agency directly | ✓ | — | — | — | — | — | — | — |
| Suspend, reactivate, deactivate; override memberships | ✓ | ✓ | — | — | — | — | — | — |
| Read all agencies | ✓ | ✓ | ✓ | — | own | own | — | — |
| Edit own agency profile | ✓ | ✓ | — | — | ✓ | if granted | — | — |
| See own agency's agents | ✓ | ✓ | ✓ | — | ✓ | if granted | — | — |

Tests: `tests/integration/agency-foundation.test.ts` (permissions, apply, documents, review decisions, approval side effects, cooldown and override, direct creation guards, applicant registration and role switch, tenant scope, manager subset, suspension, membership history).
