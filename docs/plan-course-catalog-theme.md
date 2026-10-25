# Course catalog redesign and Academy theme: plan

Source: a reference screenshot from the user (2026-10-24) showing a course grid: large cover art on each card, title, short description, a green progress bar with the percentage, "Watch now" on the cover, and a grey "Draft" pill on unpublished courses. Nothing here is implemented yet.

## 1. What exists today

- Talent `/courses`: "My courses" are text cards (`CourseCards.tsx`) with a thin progress bar; the Catalog is text cards with a price pill. No imagery anywhere.
- Coaches and admins `/courses`: `BuilderHome.tsx`, a plain list of rows with a status badge. Drafts are not visually distinct.
- `AcademyCourse.thumbnailKey` already exists in the schema and repository, but no form uploads it and no page renders it. The storage adapter already does presigned uploads and short-lived signed downloads, used by lesson media.
- Theme: Tailwind v4 tokens in `src/app/globals.css` (`ink` navy scale, `brand` green, `gold`, soft shadows, rounded-3xl cards). The look is already navy and green, close to the screenshot's navy covers.

## 2. Proposed design

**Cover art.** Every course card gets a 16:9 cover. When a coach uploads a thumbnail it is shown; when there is none, the app draws a generated cover in the Hirewise navy (title, category, difficulty, a brand-green accent) so no card is ever blank or the flat pink block in the screenshot's drafts. This also fixes empty catalogs looking unfinished on day one.

**Cards.** One shared `CourseCard` component used everywhere: cover on top (with the "Watch now" or "Continue" chip over it, a Draft or Pending pill top-left, a Locked or Payment pending pill when relevant), then title (two lines), a two-line description, and the progress bar with percentage for enrolled courses, or price plus lesson count for catalog courses. Completed courses get a check and the certificate chip. The grid is 3 across on desktop, 2 on tablet, 1 on phone.

**Pages.**
- Talent `/courses`: "Continue learning" row first (in-progress, with the next lesson), then My courses, then Catalog, with a category filter and search.
- Coaches and admins `/courses`: the same card grid with Draft, Pending approval, Published, and Archived pills and an "Open builder" action, replacing the list. Stat tiles stay.
- Course detail page header uses the same cover as a banner.

**Thumbnail upload.** A "Cover image" field on the course form and Settings tab: PNG, JPG, or WebP up to 2 MB, uploaded straight to storage with the existing presigned flow, stored in `thumbnailKey`. Served through a signed URL after the usual course visibility check (published courses to enrolled or eligible talent; any state to the owning coach and Academy staff). No new tables and no migration.

**Theme tokens.** Scoped to the Academy first: add semantic tokens in `globals.css` (`--color-surface`, `--color-surface-raised`, `--radius-card`, `--shadow-card`, course accent colors per category, a navy cover gradient), an elevated card hover, and a consistent page header. Existing `ink`, `brand`, and `gold` stay, so nothing outside the Academy changes by accident.

## 3. Out of scope

A platform-wide recolor of every page (marketing site, client marketplace, staff console), dark mode, and AI-generated cover images. Course pages stay accessible: color contrast at WCAG AA, visible focus rings, alt text from the course title.

## 4. Decisions to confirm

1. **Theme scope**: Academy first (recommended), then a separate pass for the rest of the platform once you have seen it. Or apply the new tokens platform-wide in this same change.
2. **Fallback cover**: generated navy cover with title and category (recommended), or a plain gradient with an icon.
3. **Thumbnail upload**: build it now (coaches upload; PNG, JPG, WebP, 2 MB) so real covers like your screenshot's can be used (recommended), or ship the generated covers only and add uploads later.
4. **Catalog extras**: add search, a category filter, and a "Continue learning" row (recommended), or keep the current sections and only restyle.
5. **Draft pills for coaches and admins** replace the row list with the grid (recommended), or keep the list and add thumbnails to the rows.
6. **Scope and delivery**: one phase, one PR, no migration. Tests for the signed-URL authorization (draft covers never reach talent or other coaches), upload validation, and the card states; browser check at phone, tablet, and desktop widths.

## 5. Not part of this plan

The skills migration is still waiting to be applied on production (see the previous message). That is independent of this work.
