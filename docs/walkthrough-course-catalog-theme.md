# Course catalog redesign and Academy theme

Built from `docs/plan-course-catalog-theme.md` (approved 2026-10-25 with the recommended answer to all four decisions: Academy first, uploads now, catalog extras, grid for coaches and admins). The reference was a screenshot of a course grid: large cover art, title, short description, a green progress pill, and a grey Draft pill on unpublished courses.

## What changed

| Area | Delivered |
| --- | --- |
| Cards | One `CourseTile` for every course surface: 16:9 cover, status pill top-right, action chip bottom-left ("Continue", "Start now", "Review", "View course", "Open builder"), two-line title and description, and a footer. `ProgressPill` is the green pill bar with the percentage inside. Completed courses always show 100%. |
| Covers | `CourseCover` shows the uploaded image or a generated Hirewise navy cover (title, category chip, difficulty). The accent per category is stable (`coverAccent`). The generated cover never leaves a card blank. The image is decorative (empty alt) because the title is always text beside it. |
| Talent `/courses` | "Continue learning" hero for the most recent in-progress course (next lesson, progress, one button), then My courses as the cover grid, then the Catalog with search and category chips. |
| Coaches and admins `/courses` | The same grid with Draft, Awaiting approval, Published, and Archived pills, status filter chips with counts, and "Open builder". The stat tiles stay. |
| Course page | The cover is the banner above the lessons. |
| Cover upload | Settings tab, Cover image card: PNG, JPG, or WebP up to 2 MB, sent straight to storage with a presigned PUT, then recorded with `setCourseCover`. Replace and Remove supported; the replaced object is deleted. Uses the existing `AcademyCourse.thumbnailKey`, so there is no migration. |
| Theme | Semantic tokens in `globals.css`: `surface`, `surface-raised`, `radius-card`, `shadow-card`, `shadow-card-hover`, plus `cover-navy` and `cover-grid` utilities. `gold-800` is now defined (components already referenced it). Existing `ink`, `brand`, and `gold` scales are unchanged, so pages outside the Academy look the same. |
| Dashboard | The talent dashboard keeps the compact text card (`CourseCards compact`). |

## Where the rules are enforced

- `createCourseCoverUploadUrl` and `setCourseCover` call `loadEditableCourse` first: Admin with `course.manage`, or a coach with `course.create_own` who owns or is assigned to the course; another coach gets NotFound, agents and Sales get Forbidden. MIME allow-list (PNG, JPG, WebP), 2 MB cap, rate limit, and the key must start with `courses/<id>/cover/` and exist in storage.
- The storage key never reaches a view. `coverUrlsFor` in `course-cover.ts` signs a one-hour GET link for rows the caller was already authorized to read (published courses for talent; assigned or managed courses for coaches and admins). Cover links live longer than private media links because they are marketing images for published courses.
- The upload is audited as `COURSE_COVER_SET`.
- Only the declared MIME type and size are checked; the object itself is not inspected. Covers are shown only through `<img>` from the storage origin, so a mislabelled file cannot execute.

## Migration

None. Run `npm run db:deploy` only for the pending skills migrations from the previous phase.

## Tests

`tests/integration/course-cover.test.ts` (5 tests): allowed and rejected types and sizes, scope of the key, who may upload (owner coach and Admin yes; other coach NotFound; agent and Sales Forbidden), set and replace and clear with the old object deleted and the audit row, signed links for talent only on published courses with no key or draft cover in the catalog JSON, the course page and My courses carrying the link, coaches seeing draft covers while another coach sees none. `tests/unit/course-cover.test.ts` (3 tests): stable accents, key prefix and limits, difficulty labels.

Browser checks at desktop and phone widths: talent My courses and Continue learning, search and category filter, admin grid with pills and a real uploaded cover beside generated ones, the Settings upload round trip, no horizontal overflow at 375 px.

## Also in this change

The dependency audit started failing on two new advisories (zod, nodemailer). `npm audit fix` took the non-breaking updates (zod 4.6.7, nodemailer 10.2.1) in `package-lock.json` only.

## Next

Platform-wide adoption of the new tokens (marketing site, client marketplace, staff console) is a separate pass once the Academy look is approved.
