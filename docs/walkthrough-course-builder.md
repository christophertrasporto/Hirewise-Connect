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

## Phase 3: Question Builder and quiz engine (done)

| Piece | Where | Notes |
| --- | --- | --- |
| Question Builder | lesson page → **Questions** tab, `components/academy/QuestionBuilder.tsx`, `quiz-actions.ts` | One builder for quiz, assessment, and audiobook-quiz lessons. Types: multiple choice (one correct), multiple correct answers, true/false, short answer (keywords for auto-marking; none means the coach marks it). Per question: points, explanation, required, draft/published. Reorder, duplicate (as a draft), delete. No limit on the number of questions. |
| Question service | `server/services/quiz.service.ts`, `server/repositories/quiz.repository.ts` | Validation per type (choice count, exactly one or at least one correct). Editing a question's prompt, type, choices, or keywords bumps its `version`; choice ids are kept so earlier answers still resolve. Gate: assigned coach with `course.quiz.build`, or `course.manage`. |
| Attempts | `startAttempt`, `attemptForLearner`, `submitAttempt` | Each attempt freezes a `questionSnapshot` of the published questions as shown (random draw of `randomizeCount`, optional choice shuffle). Answers are choice ids (or text), so shuffling never changes what is correct. The learner projection before submission contains no `correctChoiceIds`, `isCorrect`, or keywords; after submission the key and explanations appear only if the lesson allows. Open attempts resume. |
| Rules | lesson settings from phase 2 | Attempt limit (null = unlimited), retake wait, time limit (an overrun of more than 30 s is recorded as `EXPIRED` and never passes), passing score (lesson, else course), score policy highest/latest, show answers/explanations. Audiobook quizzes also require `mediaCompletedAt` (phase 4 sets it). |
| Scoring | `gradeSnapshot` | Choice questions are all-or-nothing by id set; short answers match any keyword case-insensitively; short answers without keywords (or review mode MANUAL/BOTH) put the attempt in `PENDING_REVIEW`. |
| Coach review | Learners tab → "Attempts awaiting your review", `reviewAttempt` | The coach records the final score and feedback; the audit row keeps the auto score. Pass/fail then flows into progress exactly like an auto-marked attempt. |
| Progress | `server/services/progress.service.ts` | `LessonProgress` per quiz (`COMPLETED`, `RETAKE_REQUIRED`, `FAILED`, `PENDING_REVIEW`), then `recalculateCourseProgress`: percent over required published lessons; when all are done the enrolment completes once (`CourseCompletion` with the best quiz score as `examScore`, `COURSE_COMPLETED` audit and event, certification evaluation), the same pipeline the legacy exam used. A course with `completionRequiresQuizPass` off completes the lesson on any submitted attempt. |
| Learner pages | `/courses/[courseId]/quiz/[lessonId]` (rules, attempt history, start/resume), `/courses/attempt/[attemptId]` (runner and review) | Course page shows the welcome message, intro video, per-lesson status chips, and the progress bar. Mobile layout checked at 375 px. |
| Removed | `Exam` service functions, `ExamBuilder`, `/courses/exam/[attemptId]`, exam fields in projections | The three legacy tables stay until a later cleanup migration; nothing reads them. Seeds create quizzes through the shared tables. |
| Tests | `tests/integration/quiz-engine.test.ts`, `tests/unit/academy-grading.test.ts`, rewritten exam sections of `academy.test.ts` and `academy-curriculum.test.ts` | Builder validation and permissions; snapshot shuffle and random draw; choice-id grading, keyword matching, manual review; answer-key leakage; attempt limits, retake wait, score policy, expiry; editing a question after attempts leaves the old snapshot intact; completion and certification pipeline. |

## Phase 4: audiobook lesson (done)

| Piece | Where | Notes |
| --- | --- | --- |
| Player | `components/academy/AudioPlayer.tsx`, rendered by `LessonContent` for audio lessons | Play/pause, seek bar, current time and duration, volume and mute, speed 0.75× to 2×, resume from the stored position. Works at phone width. Coach previews use the same player without tracking. |
| Real-listening tracking | `server/services/lesson-media.service.ts`, `POST /api/academy/lessons/[lessonId]/progress` | The player sums only forward motion at playback speed (seeks never count) and reports every 8 s, on pause, on end, and on page hide (`sendBeacon`). The server credits at most wall-clock × rate + 2 s per report, never more than 60 s, and uses the coach-side duration; the total is capped at 105 % of the duration. Stored in `LessonProgress` (`mediaSeconds`, `mediaPercent`, `lastPositionSec`, `mediaCompletedAt`, `startedAt`), so progress and the resume position follow the learner across devices. |
| Completion | `recordMediaProgress` | When the listened share reaches the lesson's required percent (default 90) the audio part is complete and a `LESSON_MEDIA_COMPLETED` audit row is written once. An audio lesson with no published questions (and, from phase 5, an uploaded video) completes outright and course progress is recalculated. An audiobook with questions unlocks its quiz instead and completes only when the quiz is passed, through the phase 3 engine. |
| Quiz gate | `quizStateForLearner` | Until `mediaCompletedAt` is set the quiz page says how much listening is still required and `startAttempt` refuses. |
| Audio statuses | `audioStatusOf`, `mediaStateForLearner` | Not started, Listening, Audio complete, Quiz pending (attempt open or awaiting review), Quiz failed (retake required or failed), Completed. The course page shows the listened share, the required mark, the unlock message, and the quiz link once unlocked. |
| Tests | `tests/integration/audio-progress.test.ts` | Enrolment and role guards, seeking to the end credits nothing, inflated reports are capped, the client's duration never overrides the coach's, honest listening at 2× reaches the threshold once, quiz pending → failed → completed, plain audio completes the lesson and the course, resume position, the six statuses. |

## Phase 5: the remaining lesson types (done)

| Type | Completion path | Where |
| --- | --- | --- |
| Video, uploaded file | Real-watching tracking through the same tracker as audio (`VideoPlayer`, native controls); completes at the lesson's required percent (default 90). | `components/academy/VideoPlayer.tsx`, `use-media-progress.ts`, `lesson-media.service.ts` |
| Video, YouTube | IFrame Player API on the privacy-enhanced host, polled twice a second into the shared tracker; seeks never count. Coach-side duration wins when set. | `components/academy/YouTubePlayer.tsx`, `lib/video-url.ts` |
| Video, Vimeo / Loom / other | Embedded as before plus **Mark as watched** (the page cannot measure those players). | `LessonActions.tsx` → `markLessonComplete` |
| Text, document, link | Opening a document or link records *In progress* (`startLesson`); **Mark as read / done** completes. Media and question lessons refuse manual marking. | `lesson-media.service.ts` (`isSelfMarked`) |
| Assignment | Learner submits per the lesson's submission type (written answer, link, file upload scoped to `courses/<id>/submissions/<profile>/`, or any of the three). Progress goes to *Pending review*; the coach grades (capped at the lesson's points), writes feedback, and marks complete or returns it. Returned work is answered with a new submission; history is append-only. Late submissions are flagged against the due date, never blocked. | `assignment.service.ts`, `assignment.repository.ts`, `AssignmentPanel.tsx`, Learners tab → "Assignments awaiting your review", `/api/academy/submissions/[id]` |
| Assessment, manual review | Review mode MANUAL holds every attempt; the review queue now shows every question with the learner's answer, the auto result, and the correct answer or keywords (AUTO mode still shows only the questions that need a human). | `attemptsAwaitingReview` |

Permissions: reviewing assignments needs `assignment.review` (COACH default) or `course.manage`; the gate is the course assignment, as everywhere else. New audit actions: `LESSON_COMPLETED`, `ASSIGNMENT_SUBMITTED`, `ASSIGNMENT_REVIEWED`.

Tests: `tests/integration/lesson-types.test.ts` (self-marking rules and refusals, uploaded and YouTube video completion, assignment validation per type, scoped uploads, review gates, return and resubmit, grading completes the course, manual-review assessment queue).

## Next phases

6. Progress, completion rules, sequential unlock, certificates with numbers on the profile.
7. Learner dashboard and Admin/Coach tracking table.
8. Safe editing of published courses and version history.
9. Welcome video on lesson infrastructure.
10. Question bank and random draws.
