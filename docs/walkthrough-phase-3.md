# Phase 3 walkthrough — Academy

Date: 2026-09-23. Implements MASTER_PROMPT.md Phase 3 (courses, assessments, coach evaluations, certifications, verification levels) plus two owner requests: coaches author their own courses and exams, and every course carries a USD price (free or paid).

## What was built

| Area | Where | Notes |
|---|---|---|
| Coach-authored courses | `/coach`, `/coach/courses/new`, `/coach/courses/[id]`, `academy.service.ts` | Coaches (`course.create_own`) create and edit courses they own or are assigned to (INV-P5). Title, category, description, syllabus, external link, passing score, coach-review flag. Admin (`course.manage`) can edit any course. |
| Pricing | `AcademyCourse.priceCents` + `currency = USD` | Entered as USD on the form, stored as integer cents (INV-I4). `0` = free. Price changes are audited separately (`COURSE_PRICE_CHANGED`). Enrolment snapshots the price. |
| Exam builder | `ExamBuilder.tsx`, `saveExam` | One exam per course: title, instructions, optional time limit, attempt limit (default 2), single-answer multiple-choice questions with points and an optional explanation. Correct answers are validated server-side and never sent to agents. Published exams are locked while the course is live. |
| Publishing workflow | `CourseStatus` DRAFT → PENDING_APPROVAL → PUBLISHED → ARCHIVED | The coach submits (an exam with at least one question is required). Admin is notified and gets a `PUBLISH_COURSE` task; publishing links a certification template and publishes the exam. |
| Talent catalog | `/courses`, `/courses/[courseId]` | Published courses with price badges. Enrolling in a free course unlocks the syllabus and exam immediately. A paid course stays locked (`CoursePaymentStatus.PENDING`) until staff record the payment. |
| Course payments | `/staff/academy/payments`, `recordCoursePayment` | Sales, Operations, and Admin hold `course.payment.record`. Amount must cover the price; waiving needs a reason; both are audited and unlock the course. No card processing (Section 14 Q8: Phase 5). |
| Exam attempts | `/courses/exam/[attemptId]`, `startExamAttempt`, `submitExamAttempt` | Timed runner with a live countdown, resume of an open attempt, attempt-limit enforcement, expiry grace of 30 s. Grading weights by points. A pass writes `CourseCompletion`, marks the enrolment COMPLETED, emits `COURSE_COMPLETED`, and runs the certification pipeline. |
| Coach assessments | `AssessmentForm` on the coach course page, `assessment.service.ts` | Type, per-type scores, strengths, areas for improvement (student-visible), internal comments (staff-only), configurable result label, certification recommendation. Finalised immediately; only the assigned coach or Admin may record one. Coach evaluations (communication, reliability, coachability, client-visible flag) are separate. |
| Certification pipeline | `certification.service.ts` | `CertificationTemplate` rules: completion, minimum exam score, coach review, minimum result-label rank, validity. Evaluated after every completion and every FINAL assessment; idempotent per agent, template, and course. Admin can issue directly with a reason (`ADMIN_ISSUED`), review pending ones, and revoke with a reason. Maintenance expires past-due certifications and warns 30 days ahead. |
| Verification ladder | `verification.service.ts`, `/staff/academy/settings` | `VerificationRequirement` rules per level (profile approved, video, recordings, certifications, assessment rank, published billing rate). Recomputed after profile approval, media approval, assessments, and certification changes. A manual override survives until the next recompute changes the outcome, then `verificationIsManual` clears. |
| Client-facing surfaces | `/talent`, `/talent/[id]`, `CandidateCard`, `agent.views.ts` | Approved certifications with template-allowed scores only (Section 6 footnote 3), best assessment label, client-visible coach evaluation, completed courses. Search filters by certification, completed course, and minimum assessment rank. Forbidden keys extended: `correctIndex`, `comments`, `areasForImprovement`, `certificationRecommended`, `priceCents`, and payment fields. |
| Staff surfaces | `/staff/academy` (publish), `/payments`, `/certifications`, `/settings`; `/staff/talent/[id]` | Certifications panel with review/revoke, direct issue form, manual verification form. |
| External LMS hook | `syncExternalCompletion` | Service for a signed inbound completion (Section 14 Q1). The HTTP route ships when an LMS is chosen. |
| Schema | migration `academy_exams_certifications` | `AcademyCourse`, `CourseCoach`, `CourseEnrollment`, `CourseCompletion`, `Exam`, `ExamQuestion`, `ExamAttempt`, `AssessmentResultLabel`, `Assessment`, `CoachEvaluation`, `CertificationTemplate`, `Certification`, `VerificationRequirement`, `AgentProfile.verificationIsManual`. |
| Permissions added | `course.create_own` (COACH), `course.payment.record` (SALES, OPERATIONS, ADMIN), `verification.manage` (ADMIN) | Proposed in-session; see `docs/decisions.md`. |

## Acceptance criteria (Section 13, Phase 3)

| Criterion | Evidence |
|---|---|
| Completion → assessment → certification flow demoed | `tests/integration/academy.test.ts`: coach builds and submits, Admin publishes, agent enrols, fails then passes the exam, coach assesses, certification issued, verification lifted to INTERVIEW_READY. Exam-only template certifies automatically. |
| Agent cannot write to `Certification` | Agents get `ForbiddenError` on issue and revoke; the pipeline runs only from server-side completion and assessment code. |
| Client sees only permitted score types | Projection unit test and integration test: template `clientVisibleScores` decides which scores appear; `practicalScore`, `strengths`, `comments`, `areasForImprovement` never reach a client. |
| Verification recomputed correctly | Unit tests for the ladder; integration tests for recompute after certification, revocation, admin rule edits, and manual override clearing. |
| Coach scoping | Unassigned coach gets `NotFoundError` on another coach's course and on assessing a student outside their courses. |
| Pricing | USD parsing without float drift, malformed prices rejected, underpayment refused, waive requires reason, paid course locked until recorded. |

## Demo script

1. `npm run db:seed` (adds labels, three templates, the ladder, and three courses owned by `coach@hirewise.example`).
2. **Coach** `coach@hirewise.example`: Coach console → Executive Assistant Playbook (USD 99, draft) → add a question in the exam builder → Save exam → Submit for publishing.
3. **Admin** `admin@hirewise.example` (MFA): Academy admin → Awaiting publication → choose the EA template → Publish.
4. **Talent** `ana@talent.example`: Academy → Appointment Setting Fundamentals (free) → Enrol → Start exam → answer → Submit. Customer Service Excellence (USD 49) shows "Payment pending".
5. **Sales** `sales@hirewise.example`: Academy admin → Payments → record 49 with a reference. Ana's paid course unlocks.
6. **Coach**: course page → Ana → Record assessment → Excellent + Recommend certification. The Appointment Setter certification is issued; Ana's verification rises.
7. **Client** `hiring@acme-solar.example`: Find talent → filter by certification → Jose R. and Ana show certification badges and the coach label.

## Known limits carried forward

- Course payments are recorded offline; Stripe is Phase 5 (Q8).
- Courses stay editable after publishing (added 2026-09-24): details, curriculum, and exam. Exam edits keep the ids of retained questions so open attempts and recorded answers stay consistent; removed questions simply stop counting.
- Retakes beyond `maxAttempts` need a coach to ask Admin; no self-service reset yet.
- The external LMS completion route (HMAC) is not exposed until an LMS is selected (Q1).
- `publishedBillingRate` in the ladder is always false until Phase 4 wires `ClientBillingRate`.

## Curriculum: modules and lessons (added 2026-09-24)

| Piece | Where | Notes |
| --- | --- | --- |
| Schema | `CourseModule`, `CourseLesson`, `LessonContentType` (`VIDEO | AUDIO | LINK | DOCUMENT | TEXT`) | Ordered modules of ordered lessons under `AcademyCourse`. Exactly one source per lesson: `body` for TEXT, `url` for LINK or hosted video, `storageKey` for uploaded video, audio, and documents. |
| Service | `academy.service.ts`: `saveModule`, `deleteModule`, `moveModule`, `saveLesson`, `deleteLesson`, `moveLesson`, `createLessonUploadUrl`, `lessonDownloadUrl` | Same authorization as course editing (`course.manage`, or `course.create_own` on an owned or assigned course; INV-P5). Works at every status, including PUBLISHED. Lesson files use the presigned upload flow with per-kind MIME and size caps; keys are scoped to `courses/<courseId>/lessons/`. |
| Projections | `toCourseAgentView` | `outline` (titles and types) is always present; `modules` with content only when the enrolment is unlocked. `storageKey` never reaches agents; files stream through `GET /api/academy/lessons/[lessonId]`, which re-checks enrolment and redirects to a short-lived signed URL. |
| UI | `components/academy/CurriculumEditor.tsx` (coach), `components/academy/LessonContent.tsx` (student) | Add, edit, reorder, and delete modules and lessons inline; upload with progress; YouTube, Vimeo, and Loom links embed as players. |
| Tests | `tests/integration/academy-curriculum.test.ts` | CRUD and ordering, ownership (NotFound for the other coach), upload rules and key scoping, KEEP_FILE edits, post-publish editing with an open attempt, agent projections. |
