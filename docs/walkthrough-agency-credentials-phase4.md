# Agency platform v2, phase 4: credential sources and independent reapplication

Phase 4 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec (plan and the approved decisions 1 to 7: `docs/plan-agency-credentials-phase4.md`). Every enrollment, certification, and assessment now records who funded it; agency-sponsored items stop counting when the membership ends; former agents can return as independent freelancers with a fresh profile. Because the old training marketplace was never built, this phase also delivers Course Seats: agencies buy seats for a course and assign them to members.

## What changed

| Area | Delivered |
| --- | --- |
| Sources | `CredentialSource` (agency sponsored, independent purchase, Hirewise direct, admin assignment) on `CourseEnrollment`, `Certification`, and `Assessment`, with `sponsoringAgencyId`. Self-enrolment in a paid course is an independent purchase, a free one Hirewise direct; a waived payment becomes an admin assignment; Hirewise-issued certifications are admin assignments; certifications and assessments inherit the source of the enrollment they came from. Backfill per decision 1. |
| Course Seats | `CoursePurchase` (per course, recorded by Hirewise as paid, waived, or cancelled, like seat packages) and `CourseSeatAssignment`. Agency portal → Training: catalog with price and seats available, "Buy course seats", "Assign course" (creates an agency-sponsored enrollment; free courses need no purchase), purchases, and each member's courses, certifications, and assessments with source and status. Course Seats are not Agent Seats and the page says so. |
| Exit | The `AGENCY_EXIT_COMPLETED` handler calls `revokeAgencySponsoredOnExit`: in-progress sponsored enrollments become `REVOKED`, completed ones keep their completion but lose access (decision 2), certifications become `INACTIVE_FOR_PLATFORM_USE`, assessments `HISTORICAL`, open course seat assignments are revoked and the seats return to the agency (decision 3), the verification level is recomputed, and both sides are notified. Idempotent; items from other sources are untouched. |
| Eligibility | The verification ladder and client views only ever counted `APPROVED` certifications and `FINAL` assessments, so inactive and historical items drop out everywhere; the regression test proves it. Revoked enrollments are refused by the course page and the lesson guard with "Access to this course has ended". |
| Independent | `IndependentAccess` and the "Apply as Independent Freelancer" form on the former agent's dashboard card and holding page: the current terms are accepted again with context `INDEPENDENT_REAPPLICATION` (decision 5); with `independentAccess.feeMinor` at 0 the fresh profile (`talentType INDEPENDENT_FREELANCER`, basics copied, former profile archived) is created at once, otherwise it waits for Hirewise to record the fee under Agencies → Seat requests and purchases → Independent access (decision 4). Blocked while any membership is open. An independent freelancer may later join an agency from its link, which archives the independent profile and creates a fresh agency profile (decision 7). |
| Admin | Seat requests and purchases now has four tabs: Agent Seat requests, seat packages, Course purchases, Independent access. |

## Where the rules are enforced

- Sources are set at creation in the repositories and inherited in `evaluateCertification` and `recordAssessment`; nothing else writes them.
- `revokeAgencySponsoredOnExit` (credential.service) is the only path that inactivates or revokes on exit, triggered by the outbox handler so it runs even when the exit completes in the worker.
- Course access: `getEnrollmentForAgent` hides content and returns `locked.kind = "REVOKED"`; `assertLessonUnlocked` refuses revoked enrollments before any sequencing rule.
- Agency reads go through `scopedAgencyId`; the training views are checked against `FORBIDDEN_FOR_AGENCY`; members outside the agency are `NotFound`.
- Permissions: portal `agency.training.read` (new), `agency.training.purchase`, `agency.training.assign`; staff `agency.seats.manage` records course purchases and independent access.

## Migration

`20261015150000_credential_sources_schema` and `20261015150001_credential_sources_data` (backfill of sources). Settings `independentAccess {enabled: true, feeMinor: 0, currency: "USD"}`.

## Tests

`tests/integration/agency-credentials.test.ts`: self-enrolment sources and inheritance; buying, recording, and assigning Course Seats with capacity and tenant checks; sponsored certifications and assessments; the exit revocation (in-progress revoked, completed kept without access, certification inactive, assessment historical, seats returned, verification recomputed, other sources untouched, idempotent); eligibility and client views; the course and lesson guards; independent reapplication without and with a fee, terms re-acceptance, fresh profile with no inherited credentials, Hirewise recording, and an independent later joining an agency.

## Next

Phase 5: client protection. Client-facing Partner Team identity, allow-list serializers for client endpoints, sanitized agent profiles and documents with a review queue, and disclosure grants.
