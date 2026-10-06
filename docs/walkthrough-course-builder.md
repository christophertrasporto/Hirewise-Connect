# Walkthrough: unified Course Builder

One builder for Admins, Coaches, and course creators: Course → Module → Lesson, one question system for quizzes, exams, assessments, and audiobook quizzes, published courses that stay editable, and learner history that is never rewritten. Built in ten phases, one pull request each. Branch base: the four September/October branches (curriculum, user roles, logo, onboarding and email delivery) merged into `feat/course-builder-phase-1`.

Decisions taken before phase 1 (owner approved):

- Coaches edit everything, always; Admin still approves a course the first time it goes live (`PENDING_APPROVAL → PUBLISHED`, as in MASTER_PROMPT). Modules, lessons, and questions carry their own `DRAFT | PUBLISHED` flag that the coach controls.
- "Assessment" as a lesson type is distinct from the existing `Assessment` table (a coach's written evaluation of a learner). The lesson type is `LessonContentType.ASSESSMENT`; the evaluation record keeps its name.
- The welcome-video gate stays on its setting-based tracker until phase 9, when it moves onto the lesson infrastructure so one tracker serves both.

## Phase 1: schema and migrations (done)

| Piece | Where | Notes |
| --- | --- | --- |
| Migration `course_builder_foundation` | `prisma/migrations/20261006025007_*` | Additive only: new enums, new tables, new nullable or defaulted columns. No drops. |
| Migration `course_builder_data` | `prisma/migrations/20261006025008_*` | Idempotent data migration, in its own transaction because Postgres cannot use a new enum value in the transaction that added it. |
| `CourseCategory` | admin-managed; seeded with Foundation, Virtual Assistant, Cold Calling, Appointment Setting, Sales, Customer Service, Leadership, Management, Agency Building, AI & Automation, Marketing, Specialized Skills, plus any category string existing courses already used | `AcademyCourse.categoryId` links; the free-text `category` column stays until phase 2 switches the forms. |
| Course fields | `thumbnailKey`, `difficulty`, `estimatedMinutes`, `isRequired`, `sequentialUnlock`, `completionRequiresQuizPass`, `completionRequiresFinalAssessment`, `displayOrder`, `introVideoUrl`, `welcomeMessage`, `accessRules`, `CoursePrerequisite` | Completion always needs every required lesson; the two booleans add quiz passes and a final assessment. |
| Module and lesson flags | `isRequired`, `status` (`PublishState`), lesson `version`, `description`, `transcript` | Existing rows default to required and published. |
| Lesson settings | media `requiredPercent` (90 for existing audio and video); quiz `passingScore`, `maxAttempts` (null = unlimited), `timeLimitMin`, `randomizeCount`, `shuffleAnswers`, `showCorrectAnswers`, `showExplanations`, `retakeWaitMinutes`, `scorePolicy`, `reviewMode`; assignment `dueAt`, `points`, `submissionType` | Lesson type drives which fields the form shows (phase 2). |
| `Question` + `QuestionChoice` | shared by every question-bearing lesson type; `lessonId` null means bank-only; correctness is per choice id; `state` has `SUGGESTED` for future AI drafts; `keywords` for short-answer auto-match | Replaces `ExamQuestion` from phase 3 onward. |
| `QuizAttempt` | immutable; `questionSnapshot` freezes question ids, versions, points, and the choice order shown; `answers` is `questionId → choice ids or text` | Replaces `ExamAttempt` from phase 3 onward. |
| `LessonProgress`, `CourseProgress`, `AssignmentSubmission`, `LessonVersion` | per-learner lesson state with actually played seconds; cached course percent; assignment submissions and grading; lesson snapshots before significant edits | |
| `Certification.certificateNumber`, `verificationCode` | unique, printed on the certificate and used for public verification (phase 6) | |

Data migration results on the local demo database: 14 categories, 6 of 6 courses linked, 5 exams converted into a "Final exam" module with a QUIZ lesson each (ids reused: lesson = exam id, question = exam question id, attempt = exam attempt id), 16 questions, 63 choices with exactly 16 correct, 1 attempt with snapshot and mapped answers. Legacy `Exam`, `ExamQuestion`, and `ExamAttempt` rows are untouched until the quiz engine (phase 3) replaces the code paths that read them.

Tests: `tests/integration/course-builder-schema.test.ts` builds a legacy exam through the old tables, runs the data migration twice, and asserts the conversion and idempotency, then exercises the new tables' uniqueness and cascade rules.

Not in phase 1: any UI, navigation, service, or permission change. The app behaves exactly as before.

## Phase 2: permissions and the Course Builder shell (done)

| Piece | Where | Notes |
| --- | --- | --- |
| Navigation | `src/app/(app)/layout.tsx` | One **Courses** item for talent, coaches, and Academy administrators. "Academy", "Coach console", and "Academy admin" are gone from the main nav; their pages remain and are linked from the Courses home. `/coach/courses/*` redirects into the builder. |
| Courses home | `/courses` → `components/academy/BuilderHome.tsx` for builders, the learner catalog for talent | Course list with status, module and lesson counts, enrolments; links to Learners & assessments, Approvals, Categories, Payments, Certifications, Onboarding (each by permission). |
| Builder | `/courses/manage/[id]` with tabs Overview · Modules & Lessons · Learners · Progress · Certification · Settings (`BuilderTabs`, `load.ts` shares one course load per request) | Overview: course form (category from the admin table, difficulty, duration, price, intro video, welcome message), publishing, coaches. Modules & Lessons: `CurriculumEditor` with required/draft flags, duplicate, reorder, and a type-driven lesson form. Settings: completion rules, sequential unlock, display order, prerequisites, verification gate, archive. Certification: template link (Admin) and the completion rules in plain words. Progress: enrolment table until phase 7. |
| Lesson page | `/courses/manage/[id]/lessons/[lessonId]` with Content · Questions · Settings · Preview | Questions tab is a placeholder until phase 3. Preview reuses the learner renderer. |
| Lesson types | all eight selectable; the form shows only the fields the type uses (`normaliseLesson` clears the rest) | Quiz/assessment: passing score, attempts, time limit, random draw, shuffle, show answers/explanations, retake wait, score policy, review mode. Assignment: submission type, due date, points. Audio/video: required play percentage (default 90). |
| Categories | `/courses/manage/categories`, `category.service.ts` | Admin CRUD with order and active flag; renaming keeps the legacy text column in sync; inactive categories cannot be chosen for new courses. |
| Permissions | `course.audio.upload`, `course.quiz.build`, `assignment.review`, `learner.progress.read` | Included in the COACH role by default and grantable individually to any user through Super Admin overrides. Audio and video uploads now require `course.audio.upload` (Admin always may); course visibility stays enforced by course assignment. |
| Learner projection | `academy.views.ts` | Learners only ever receive published modules and published lessons; the outline hides drafts too. |
| Tests | `tests/integration/course-builder.test.ts` | categories and permission, builder fields and category sync, settings and prerequisites, template linking, per-type lesson storage, draft visibility, duplicates without learner data, upload permission. |

Kept from before: Admin approves the first publish; everything else is coach-editable at any status.

## Next phases

3. Question Builder and quiz engine (scoring by choice id, shuffle, retakes, attempt history); legacy exam code removed.
4. Audiobook lesson: upload, player, real-listening tracking, resume, quiz gating, the six audio statuses.
5. Remaining lesson types: video, text, document, link, assignment with review, assessment with manual review.
6. Progress, completion rules, sequential unlock, certificates with numbers on the profile.
7. Learner dashboard and Admin/Coach tracking table.
8. Safe editing of published courses and version history.
9. Welcome video on lesson infrastructure.
10. Question bank and random draws.
