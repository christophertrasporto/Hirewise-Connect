# Free-preview lessons and one access rule: findings and plan

Request 2026-10-27. Nothing is built yet; this is the exploration and proposal you asked for before any code.

## 1. How courses, purchases and access work today

- **Course structure.** `AcademyCourse` has `CourseModule` rows, and each module has `CourseLesson` rows. Order is per module (`order`), not a single position across the course. Lessons have a type (`VIDEO`, `AUDIO`, `LINK`, `DOCUMENT`, `TEXT`, `QUIZ`, `ASSIGNMENT`, `ASSESSMENT`), a draft or published `status` (modules too), `isRequired`, `durationSec`, and `requiredPercent` (default 90) for media. Courses also carry a single `introVideoUrl` (a hosted link) and a `welcomeMessage`.
- **Purchase and ownership.** A purchase is a `CourseEnrollment` for a talent profile. Owning means `paymentStatus` is `NOT_REQUIRED` (free), `PAID`, or `WAIVED`, and the enrolment is not revoked. `PENDING` is not owned. A refund or chargeback (`recordCourseRefund`) sets `REFUNDED` and `accessRevokedAt` at once; agency exits revoke sponsored enrolments the same way. Only talent enrol; clients cannot buy courses.
- **Where access is decided.** In several places, not one: `getEnrollmentForAgent` (computes `unlocked`), `lessonDownloadUrl` (rejects `PENDING`, then calls `assertLessonUnlocked`, which rejects revoked or refunded enrolments and sequential locks), the quiz, assignment and lesson-progress services (each calls `assertLessonUnlocked`), and the course page. Refund removal works today, but the rule lives in four to five spots.
- **Gaps found while reading.** `lessonDownloadUrl` does not check that the lesson or its module is published for a learner, so an unpublished lesson's file is reachable by a learner who knows its id. The course page is behind login (`(app)/courses/[courseId]`), so a logged-out visitor cannot see a course at all. The public `/academy` page is a static marketing page with no real course data.
- **Progress.** `LessonProgress` already stores `lastPositionSec`, `mediaPercent`, `completedAt`, and the 90% rule through `requiredPercent`; the course page already shows `CourseProgress` for the owner. So the `lesson_progress` table you describe exists, keyed by talent profile.

## 2. Where videos live and how they are served

- **Uploaded files** go straight from the browser to private object storage (Cloudflare R2 or any S3-compatible bucket in production, local disk in development) with a presigned PUT. The storage key never reaches a page or an API response. Playback is `<video src="/api/academy/lessons/<id>">`; that route checks the user, then answers with a 302 to a presigned GET that lasts `SIGNED_URL_TTL_SECONDS` (default 10 minutes, shared by every file type). The HTML only ever contains the route, never a bucket URL. Nothing is on a public or permanent bucket URL.
- **Hosted links** (YouTube, Vimeo, Loom) are stored in `url` and embedded as an iframe. Those links are public by nature and are sent to the browser; we cannot gate them. The course `introVideoUrl` is the same kind of link.
- **No streaming platform** (Mux, Bunny, Cloudflare Stream) is in use, so there is no HLS, transcoding or provider-signed playback today; MP4 is served progressively from the bucket.
- **What needs migrating for gating:** any gated video lesson that currently points at a YouTube, Vimeo or Loom link must be re-uploaded as a file (or moved to a provider with private, domain-restricted playback). I can add a staff list of "gated lessons that use a hosted link" so you see exactly which ones; I cannot see production data myself.

## 3. Proposed plan

1. **Reuse the existing lesson, module and progress tables** instead of adding a second `lessons` and `lesson_progress`. Add one column: `CourseLesson.isFreePreview` (default `false`). Position is module order then lesson order; reordering never touches `isFreePreview`. Two parallel lesson systems would break quizzes, certificates and progress, so I recommend against a new table.
2. **One access function, `canWatchLesson`**, in `src/server/policies/lesson-access.ts`: true when (the lesson, its module and the course are published and `isFreePreview`) or the user owns the course (the rule above, refunds and revokes included) or the user is staff who manage courses (and the course's own coaches, as today). Every route and service that serves or unlocks lesson content calls it; the scattered checks are removed. It also fixes the unpublished-lesson gap.
3. **Video delivery:** keep private storage. The lesson route allows a logged-out visitor only when `canWatchLesson` says it is a published preview; otherwise 401 or 403. Gated files use a signed URL with a new `LESSON_VIDEO_URL_TTL_SECONDS` (default 7200, two hours); preview files use a short signed URL too (the bucket stays private, so there is still no permanent link). Gated lessons must be uploads, and the admin form refuses a hosted link on a lesson that is not a preview.
4. **Public course landing page** at `/academy/courses/[courseId]`: preview player at the top (works logged out), curriculum with durations, "Free preview" badges and lock icons, and a Buy course button (log in or sign up as talent, then enrol and pay, with the promo-code box from the other plan). Owners are sent to the existing lesson view.
5. **Referral links keep working** on that page: a small client component posts `?ref=` to a new `/api/referral/capture` route that reuses `recordClick` and sets the same cookie, so `/academy/courses/<id>?ref=CODE` credits the referrer.
6. **Owner lesson player:** the existing course page already has the player, outline, progress and sequential unlock. I add next and previous links and keep the 90% rule.
7. **Admin:** per-lesson Free preview and Published toggles on the lesson form; drag-and-drop reorder within a module (keeping the up and down buttons as the keyboard route); a non-blocking warning when a course is submitted for approval or published with no free-preview lesson.
8. **Migration:** for each course with `introVideoUrl`, create a first module "Welcome" with one VIDEO lesson (`isFreePreview = true`, `isRequired = false`, `status` published), using that URL. It is not required so existing completion percentages and certifications do not change; existing enrolments are untouched. `introVideoUrl` stays in place (nothing dropped).

**Tests** (in one integration file): logged-out visitor watches a preview and is refused a gated lesson; a logged-in non-owner is refused; the owner watches all lessons and loses access after a refund; reordering changes no access; gated pages and APIs never return a raw bucket URL and signed URLs expire; unpublished lessons are hidden from everyone except staff; plus the referral capture and the migration.

## 4. Decisions for you

1. Reuse the existing lesson and progress tables (recommended), or build new `lessons` and `lesson_progress` tables as written in your brief.
2. Welcome video becomes a first "Welcome" module with one non-required lesson (recommended).
3. Stay on our private R2 or S3 storage for video (recommended now), or move to Mux, Bunny or Cloudflare Stream (needs an account, signing keys, and re-encoding; better for long videos at scale).
4. Public course URL `/academy/courses/<id>` (recommended), or a slug.
5. Buy course is for talent only; clients see the page but are told courses are for talent (recommended).
6. Gated lessons cannot use YouTube, Vimeo or Loom links (recommended), so every gated lesson is really protected.

## 5. Rollout

One PR after the promo-code PR. One additive migration (one column plus the Welcome lessons). One optional environment variable, `LESSON_VIDEO_URL_TTL_SECONDS`. No new provider keys unless you pick option 3.
