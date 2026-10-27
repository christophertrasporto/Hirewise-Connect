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
- A gated video must be an uploaded file (a YouTube, Vimeo, or Loom link cannot be protected). A free preview may be a hosted link.
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

- Existing gated video lessons that point at YouTube, Vimeo, or Loom are public by nature; re-upload them as files. They keep working until edited, but saving one as a gated video now asks for an upload. Mark one lesson per course as a free preview (the migration does this for each course that had an intro video).
- Post-login return: after signing up from the course page a new account lands on the dashboard, not back on the course (the app has no return-to-page redirect yet).

## Tests

`tests/integration/lesson-previews.test.ts` (26): logged-out visitor watches a preview and gets 401 on a gated lesson; non-owner and pending buyers get 403; owners watch everything; a refund, chargeback, and revoke remove access at once; reordering changes no access; the public and non-owner views never carry a source, storage key, or bucket address; signed links expire (two hours for video, ten minutes otherwise, setting honoured); unpublished lessons, modules and previews are hidden from everyone except staff; previews cannot be tracked by non-owners; saving rules; the admin warning; referral capture; the Welcome migration (first, free, not required, idempotent, completion unchanged).
