# Free-preview lessons and one lesson access rule

Built 2026-10-27 from `docs/plan-lesson-previews.md` (all six recommendations approved).

## What visitors see

- **Public course page** `/academy/courses/<courseId>`: a free-preview player at the top that works without an account, the full curriculum (titles, types, durations) with a "Free preview" badge on preview lessons and a lock on the rest, and a Buy course button. Signed-out visitors are sent to create a talent account; signed-in talent go to the course page to enrol and pay (with the promo-code box); owners see Continue learning; clients and staff are told courses are for talent.
- **Referral links** keep working on that page: `/academy/courses/<id>?ref=CODE` is posted by a tiny client component to `/api/referral/capture`, which logs the click and sets the same `hw_ref` cookie `/join` sets, so the referrer is credited at sign-up. It never blocks the page and ignores unknown codes.
- **Only free-preview lessons are playable on that page.** A gated lesson appears as an outline entry only: no source, link, body, or storage key.

## What owners see

- The existing course page with progress, plus **Open the lesson player**: `/courses/<courseId>/lessons/<lessonId>` shows the lesson, a sidebar of every lesson in course order (completed ticks, locks for sequentially locked lessons), and Previous and Next links. Video progress uses the same tracker as before: 90% actually watched completes the lesson, and `LessonProgress` stores the last position.

## Admin

- Lesson settings have a **Free preview** checkbox; new lessons are gated. Free preview lessons carry a badge in the builder. Quizzes, assignments, and assessments cannot be previews.
- The free preview (welcome) video must be an uploaded file that Hirewise hosts. Every other video lesson may be a YouTube, Vimeo, or Loom link. Those links are public by nature: the app never shows them to people who do not own the course, but it cannot stop an owner sharing one, whereas an uploaded video is only reachable through a signed link. The builder warns when a free-preview video is still an external link.
- **Drag and drop** reorders lessons within a module (the up and down buttons remain as the keyboard route). Order never changes access.
- The builder shows a non-blocking warning when a course has no published free-preview lesson.

## The one access rule

`src/server/policies/lesson-access.ts`: `canWatchLesson(db, actor | null, lessonId)` and `assertCanWatchLesson` (pure core `canWatchLessonWith`). A lesson may be watched when

1. the lesson, its module, and its course are published and the lesson is a free preview (anyone, signed in or not), or
2. the viewer owns the course (`entitledToCourse`: free, paid, or waived, not refunded, charged back, or revoked) and the lesson and module are published, or
3. the viewer is staff who manage the course (`course.manage`, or a coach who owns or is assigned to it), including unpublished lessons.

It follows `isFreePreview` only, never position. Everything that serves or tracks lesson content goes through it: the lesson file route (`/api/academy/lessons/[lessonId]`), the owner course view (`unlocked`), the public course page, and lesson, quiz, assignment, and media progress (`assertLearnerOwnsLesson`: previews can be watched by anyone but only tracked by an owner). Responses: unknown or unpublished lesson 404; signed out on a gated lesson 401; signed in without the course 403. A refund or chargeback sets `accessRevokedAt`, so access ends at once.

## Video delivery

Uploads stay in private storage (R2 or S3, local disk in development). The browser only ever sees `/api/academy/lessons/<id>`, which checks the rule and answers 302 to a signed URL: `LESSON_VIDEO_URL_TTL_SECONDS` (default 7200, allowed 60 to 86400) for video, `SIGNED_URL_TTL_SECONDS` (600) for other files. Preview files are private objects too, so there is no permanent link anywhere.

## Data

Migration `20261027100000_lesson_free_preview`: column `CourseLesson.isFreePreview` (default false) and a data step: every course with an `introVideoUrl` gets a first module "Welcome" (not required) with one VIDEO lesson (free preview, not required, using that URL). The step is idempotent (fixed ids, `ON CONFLICT DO NOTHING`), keeps `introVideoUrl`, and because the module and lesson are not required it changes nobody's completion or certification. No other tables. One optional environment variable: `LESSON_VIDEO_URL_TTL_SECONDS`.

## To do on your side

- The Welcome lessons the migration created use each course's old intro video link. Replace each with an uploaded video (the builder shows a warning on those courses until you do). Mark one lesson per course as a free preview if a course has none.
- Post-sign-up return (added afterwards): Buy course and Log in on the public course page now bring the visitor back to the course once they are signed in; see "Return to the course after sign-up" below.

## Tests

`tests/integration/lesson-previews.test.ts` (26): logged-out visitor watches a preview and gets 401 on a gated lesson; non-owner and pending buyers get 403; owners watch everything; a refund, chargeback, and revoke remove access at once; reordering changes no access; the public and non-owner views never carry a source, storage key, or bucket address; signed links expire (two hours for video, ten minutes otherwise, setting honoured); unpublished lessons, modules and previews are hidden from everyone except staff; previews cannot be tracked by non-owners; saving rules; the admin warning; referral capture; the Welcome migration (first, free, not required, idempotent, completion unchanged).

## Return to the course after sign-up

A signed-out visitor who clicks **Buy course** (or **Log in**) on a public course page is sent to sign up (or log in), and after every sign-in gate (email verification, terms, two-factor) they land on that course's page ready to enrol and pay, instead of on the dashboard.

- The course page links go to `/api/return/start?to=/courses/<id>&next=register|login`. That route validates the destination, stores it in the first-party cookie `hw_return` (httpOnly, SameSite Lax, 24 hours), and redirects to sign-up (talent) or login. These are plain anchors, not prefetched links.
- Every sign-in path already ends at the dashboard after the gates, so the dashboard is the single place that uses it: for a talent account with a valid `hw_return` cookie it redirects to `/api/return/continue`, which goes to `/courses/<id>` and deletes the cookie. It is used once. Clients, agencies, and staff are not redirected.
- The cookie survives the verification email (same browser). Logging out deletes it.
- Only course pages are ever allowed (`safeReturnPath` in `src/lib/return-to.ts`: `/courses/<id>` or `/academy/courses/<id>`, query and fragment dropped, nothing else). The value is checked when it is set and again when it is used, so a tampered cookie can only land on the dashboard; there is no open redirect.
- Not covered: signing up on a different device or browser than the one that clicked Buy course (the cookie is per browser), and a signed-out visitor who opens `/courses/<id>` directly and is bounced to login.
