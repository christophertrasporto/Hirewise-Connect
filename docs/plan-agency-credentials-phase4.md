# Agency platform v2: Phase 4 plan, credential sources and independent reapplication

Phase 4 of the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec. It builds on phase 3 (`docs/walkthrough-agency-exit-phase3.md`), whose `AGENCY_EXIT_COMPLETED` event is the hook this phase fills. Because the old A3 training marketplace was never built, this phase also delivers the minimum of it that "agency-sponsored" needs: agencies buy Course Seats for a course and assign them to members. Course Seats and Agent Seats stay separate in data, labels, and code.

## 1. What exists and what this phase adds

| Area | Today | Phase 4 |
| --- | --- | --- |
| Enrollments | `CourseEnrollment` with `source INTERNAL / ACADEMY_SYNC` (where the completion came from), payment status, price snapshot; agents enrol themselves | `credentialSource` (agency sponsored, independent purchase, Hirewise direct, admin assignment), `sponsoringAgencyId`, course seat link, `accessRevokedAt`; status `REVOKED` |
| Certifications | `status PENDING_REVIEW / APPROVED / REVOKED / EXPIRED`; `revokeCertification` for cause | `credentialSource`, `sponsoringAgencyId`, new status `INACTIVE_FOR_PLATFORM_USE` with `inactivatedAt` and reason, distinct from a revocation for cause |
| Assessments | `status DRAFT / SUBMITTED / FINAL` | `credentialSource`, `sponsoringAgencyId`, new status `HISTORICAL` with `historicalAt` |
| Eligibility | The verification ladder counts `APPROVED` certifications; client views show `APPROVED` certifications and the best assessment | Unchanged rules, so inactive and historical items drop out everywhere automatically; a regression test proves it on every view and on the ladder |
| Agency training | Placeholder page | Catalog of published courses, course seat purchases recorded by Hirewise, assignment to members (creates an agency-sponsored enrollment), per-member progress, certifications and assessments with source and status |
| Exit | `AGENCY_EXIT_COMPLETED` published, no handler | Handler revokes the agency-sponsored items of the leaving agent, returns course seats to the agency, and recomputes the verification level |
| Independent | `talentType INDEPENDENT_FREELANCER` exists, nothing creates it | "Apply as Independent Freelancer" for former agents: current terms re-accepted, optional access fee recorded by Hirewise, fresh independent profile, onboarding as usual |

## 2. Schema (one additive migration with a backfill)

- `enum CredentialSource { AGENCY_SPONSORED, INDEPENDENT_PURCHASE, HIREWISE_DIRECT, ADMIN_ASSIGNMENT }`.
- `CourseEnrollment` gains `credentialSource` (default HIREWISE_DIRECT), `sponsoringAgencyId?`, `courseSeatAssignmentId?`, `accessRevokedAt?`, `revokeReason?`; `EnrollmentStatus` gains `REVOKED`.
- `Certification` gains `credentialSource`, `sponsoringAgencyId?`, `inactivatedAt?`, `inactiveReason?`; `CertificationStatus` gains `INACTIVE_FOR_PLATFORM_USE`.
- `Assessment` gains `credentialSource`, `sponsoringAgencyId?`, `historicalAt?`; `AssessmentStatus` gains `HISTORICAL`.
- `CoursePurchase {id, agencyId, courseId, seatCount, amountMinor, currency, status PENDING / PAID / WAIVED / CANCELLED, paymentReference?, paidAt?, recordedById?, requestedById, note?}` and `CourseSeatAssignment {id, coursePurchaseId, agencyId, courseId, agentProfileId, enrollmentId?, assignedById, assignedAt, revokedAt?, revokeReason?}`. Course seats available = purchased (paid or waived) minus open assignments.
- `IndependentAccess {id, userId, platformIdentityId, status PENDING_PAYMENT / ACTIVE / CANCELLED, amountMinor, currency, paymentReference?, paidAt?, recordedById?, profileId?, createdAt}`.
- Settings `independentAccess {enabled: true, feeMinor: 0, currency: "USD"}`.
- Backfill (decision 1): enrollments paid by the agent become `INDEPENDENT_PURCHASE`, waived ones `ADMIN_ASSIGNMENT`, the rest `HIREWISE_DIRECT`; all existing certifications and assessments `HIREWISE_DIRECT`. Nothing existing is agency sponsored, so no current exit revokes anything.

## 3. Flows

- **Course seats**: Owner opens Training → catalog (published courses with price) → "Buy course seats" (count) → `CoursePurchase PENDING` → Hirewise records paid, waived, or cancelled (same queue pattern as seat packages, decision 6) → seats available. Free courses need no purchase: assignment creates the enrollment directly as agency sponsored.
- **Assignment**: Owner assigns a course to a member with an open membership → `CourseSeatAssignment` plus an enrollment (`credentialSource AGENCY_SPONSORED`, `sponsoringAgencyId`, payment status waived with the purchase as reference). Progress, completions, and certifications flow through the existing Academy; certifications and assessments issued from a sponsored enrollment inherit the source and agency.
- **Agent purchases** keep working as today and are `INDEPENDENT_PURCHASE`; Admin-recorded waivers are `ADMIN_ASSIGNMENT`; free enrolments of direct talent are `HIREWISE_DIRECT`.
- **Exit** (`AGENCY_EXIT_COMPLETED` handler, idempotent): for the leaving agent and that agency, enrollments in progress become `REVOKED` with `accessRevokedAt`; completed enrollments keep their completion but lose access (decision 2); certifications become `INACTIVE_FOR_PLATFORM_USE`; assessments become `HISTORICAL`; open course seat assignments are revoked and the seats return to the agency (decision 3); the verification level is recomputed; the agent and owner are notified. Items earned independently or through Hirewise Direct are untouched.
- **Access gate**: lesson and course pages refuse a revoked enrollment with a clear message; the learner's course list shows the source and the revoked state.
- **Independent reapplication**: a former agent (no open membership, decision 7 of phase 3) sees "Apply as Independent Freelancer" on the dashboard card: the current terms are accepted again with context `INDEPENDENT_REAPPLICATION` (decision 5); if the fee is 0 the fresh profile (`talentType INDEPENDENT_FREELANCER`, basics copied, the former profile archived) is created at once; otherwise an `IndependentAccess` waits for Hirewise to record the payment, then the profile is created (decision 4). Blocked while any membership is open or ending. The new profile starts at onboarding with no inherited credentials.
- **Independent joining an agency later**: the invitation link works; the independent profile is archived and a fresh agency profile created, per the rejoin rule (decision 7).

## 4. Server

- `credential.service.ts` (sources, revocation on exit, inactivation, recompute), `training.service.ts` (catalog for agencies, course purchases, assignments, member progress), `independent.service.ts` (eligibility, apply, record access payment, profile creation); repositories `training.repository.ts`, `independent.repository.ts`; small extensions to `academy.repository.ts`, `certification.repository.ts`, `assessment.repository.ts`.
- `academy.service.enrol` and the sync completion path set the source; `evaluateCertification` and assessment finalisation copy source and agency from the enrollment.
- Permissions: portal `agency.training.purchase` and `agency.training.assign` (exist) for buying and assigning; `agency.training.read` for the Training tab; staff `agency.seats.manage` records course purchases and independent access payments; `course.manage` unchanged.
- Audit: `COURSE_PURCHASE_CREATED / RECORDED`, `COURSE_SEAT_ASSIGNED / REVOKED`, `CREDENTIALS_REVOKED_ON_EXIT`, `CERTIFICATION_INACTIVATED`, `ASSESSMENT_HISTORICAL`, `INDEPENDENT_APPLIED`, `INDEPENDENT_ACCESS_RECORDED`, `PROFILE_FRESH_CREATED`. Events: `COURSE_PURCHASE_CREATED / RECORDED`, `COURSE_SEAT_ASSIGNED`, `CREDENTIALS_REVOKED`, `INDEPENDENT_APPLIED / ACTIVATED`.
- Views: agency training views (members, assignments, progress, credentials with source and status; no identity or private keys), learner credential views with source, staff queues.

## 5. UI

- Agency portal → Training: catalog with "Buy course seats", purchases and their status, seats available per course, "Assign to member", member progress table, certifications and assessments with source and status.
- Agent: My Courses shows the source and a revoked banner; the dashboard card for former agents gains "Apply as Independent Freelancer" with the terms checkbox and fee notice.
- Staff: Agencies → Seat requests and purchases gains "Course purchases" and "Independent access" tabs; the identity history shows sources and inactivations.

## 6. Tests

Source set on every enrolment path; sponsored assignment creates the enrollment and consumes a course seat; purchase states; exit revokes only the leaving agency's sponsored items (in-progress revoked, completed kept without access, certification inactive, assessment historical), returns course seats, recomputes verification, and leaves independent and direct items alone; inactive and historical items never satisfy the ladder or appear in client views; revoked enrollments are refused by the course pages; independent reapplication with and without a fee, terms re-acceptance, fresh profile with no inherited credentials, blocked while a membership is open; an independent later joining an agency gets a fresh agency profile; tenant scope and forbidden keys on every agency view.

## 7. Decisions to confirm

1. **Backfill**: agent-paid enrollments become independent purchases, waived ones admin assignments, the rest Hirewise direct; existing certifications and assessments are Hirewise direct. No existing item is agency sponsored.
2. **Completed sponsored courses** keep their completion in history but lose course access, and the certification becomes inactive for platform use.
3. **Course seats** return to the agency's pool when an assignment is revoked by an exit.
4. **Independent access fee**: a setting, default 0. With a fee, the fresh profile is created only after Hirewise records the payment.
5. **Terms**: independent reapplication records a new acceptance with context `INDEPENDENT_REAPPLICATION` even when the person is already current.
6. **Course purchases** are recorded or waived by Hirewise, like seat packages; no checkout yet.
7. **Independent to agency**: an independent freelancer may join an agency from its link; the independent profile is archived and a fresh agency profile created.
