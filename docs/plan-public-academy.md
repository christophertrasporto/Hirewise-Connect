# Public Academy: findings and plan

Requested 2026-10-28, started 2026-10-29. Nothing is built yet; this is the exploration and proposal asked for before any code.

## 1. What exists today

### Courses, lessons, coaches, purchases
- `AcademyCourse`: title, a category, description, difficulty (beginner, intermediate, advanced), estimated minutes, price and currency, a cover (`thumbnailKey`), one owner coach plus co-coaches (`CourseCoach`), modules and lessons. Lessons carry `durationSec` and the new `isFreePreview`. Lifecycle is `status`: DRAFT, PENDING_APPROVAL, PUBLISHED, ARCHIVED.
- **Missing for what you describe:** a slug (only a unique internal `code`), a short pitch, "what you'll learn", "who it's for", requirements, FAQ, a featured flag, a way to hide the enrolled count, reviews and ratings (there is no review table at all), and any notion of unlisted.
- **Coaches have no public identity.** The `User` table has an email and nothing else (no name, photo, bio, headline or social links). Everywhere a coach name appears today it is the part of their email before the `@`. A coach profile needs a new table.
- **Purchases** are enrolments (`CourseEnrollment`: pending, paid, waived, free, refunded); the number enrolled is a count of enrolments. Only talent buy courses.
- **Categories** already exist (`CourseCategory` with a name, slug, order and active flag) with an admin screen. Level already exists (difficulty). Total duration and lesson count are computable. Rating, popularity by review, and "has free preview" need queries over the new data.
- **Approval flow already exists, partly:** a coach submits a draft for approval (`submitCourseForApproval`), and an Admin publishes it (`publishCourse`) or archives it. There is **no reject-with-reason** and no setting to turn approval off (publishing needs `course.manage`).

### How pages render
- Everything under `(marketing)` is a server component. `/academy` is a **static** marketing page with a hand-written list of ten example topics, not real courses. The public course page I built (`/academy/courses/[courseId]`) is server-rendered but forced **dynamic** because it reads the visitor's session, so it cannot be cached; its content is in the HTML (good for search engines), its address is an internal id.
- There is **no sitemap, no robots file, no structured data, no per-page canonical, and no middleware**. The site-wide `metadataBase` is a placeholder (`connect.hirewise.example`) rather than your real domain; the real address is in the `APP_URL` setting, which the code does not use for metadata. Open Graph is one generic default for the whole site.
- Course cover images are private files served as **signed links that expire in about an hour**. That cannot be used for Open Graph images, a sitemap, or cached pages; a stable public thumbnail address is needed.
- The preview video element currently preloads its metadata as soon as the page loads (your brief wants nothing loaded until play).

### Routing, auth, and the referral cookie
- No auth middleware: each page and route checks the session itself. `/academy/**` and the marketing pages are already public; the learner course pages (`/courses/...`), the wallet, staff and account pages require sign-in.
- Referral: `/join?ref=CODE` records the click and sets the `hw_ref` cookie (last click wins, 30 days); I added `/api/referral/capture` and a small `ReferralCapture` component, currently used only on the public course page. Only talent and agency owners are eligible to hold a referral code; **coaches are not**, so the "Share this course" button for coaches needs a decision.
- Sign-up: the talent form asks for about ten things (legal name, professional name, email, password, phone, city, country, timezone, primary role, years of experience). Your brief wants name, email, password. There is no Google login in the app.
- After sign-up the return-to-course feature sends the buyer to the course page (`/courses/<id>`), where they still have to press Enrol and then pay; it does not go straight to checkout.

## 2. Proposed design

**Visibility.** Keep `status` as the lifecycle and add a listing choice, `LISTED` or `UNLISTED` (default LISTED). draft = DRAFT or PENDING_APPROVAL (coach and admins only); unlisted = PUBLISHED and UNLISTED (reachable by link, `noindex`, hidden from the catalog, search, categories, related courses and the sitemap); published = PUBLISHED and LISTED. Archived stays hidden. **Approval:** add reject-with-reason (the course returns to DRAFT with the reason shown to the coach) and a setting `academy.requireApproval` (default on); when off, a coach publishes their own course (still needs a published lesson).

**Addresses and slugs.** `/academy` (catalog), `/academy/category/[slug]`, `/academy/[course-slug]`, `/coaches/[coach-slug]`. A slug is generated from the title (unique, editable by coach and admin); every old slug is kept in a redirect table and answers 301. The current id-based addresses (`/academy/courses/<id>`) keep working by redirecting 301 to the slug. Reserved words (`category`, `courses`) cannot be slugs.

**New data (additive; each new table needs your approval):**
- On `AcademyCourse`: `slug`, `listing`, `pitch`, `learningPoints`, `audience`, `requirements`, `faq`, `hideEnrolledCount`, `featuredRank`, `reviewNote` (the rejection reason).
- `CoachProfile`: coach, slug, display name, headline, bio, photo, social links, public on or off. Coaches edit it at `/coach/profile`; it replaces the email prefix everywhere a coach is named.
- `CourseReview`: one per enrolment, rating 1 to 5 and text; only an owner whose access is current (paid, waived or free, not refunded or revoked) can write one; shown as first name and last initial; staff can hide a review with a reason.
- `SlugRedirect`: old slug to target, for courses and coaches.
- Existing published courses become LISTED, so they appear in the public catalog the day this ships (an owner can mark any of them unlisted first).

**Rendering and speed.** Public pages read no cookies, so they are server-rendered, cached, and refreshed when a course, coach, review or category changes (tag-based revalidation, with a short time limit as a fallback). The visitor-specific parts ("Continue course" instead of "Buy course", the Share link) load in a small client island from a no-store endpoint, so the cached HTML is the same for everyone and fully readable by search engines. Thumbnails are lazy-loaded from a stable public address that answers with a short-lived signed redirect (published and unlisted courses only; drafts never). The preview video loads nothing until it is played and shows the cover as its poster.

**Search engines and sharing.** `sitemap.xml` (published and listed courses, categories that have courses, public coaches), `robots.txt` (blocks dashboards, checkout, account, wallet, staff and API paths), a canonical address on every public page (never containing `ref`), `noindex` on unlisted pages, unique titles and descriptions built from course or coach data, Open Graph and Twitter cards with the thumbnail, and JSON-LD (Course with an offer, AggregateRating where reviews exist, Person for coaches, breadcrumbs). All of it uses `APP_URL`, which must be your real domain.

**Catalog and pages.** Catalog grid with the fields you listed, search over title, description, pitch and coach name, filters (category, price range including free, level, has free preview), five sorts, 12 per page, every choice in the URL so it can be shared, designed empty and no-results states, a featured row at the top. Course page: preview video first, sticky Buy button (sticky bar on phones), what you'll learn, who it's for, requirements, curriculum with previews and locks, coach card, verified reviews with average and count, enrolled count (admins can hide it), refund summary, FAQ, related courses. Coach page: photo, name, headline, bio, links, their listed courses, total students, average rating.

**Buying.** `/courses/<id>/buy`: signed-in talent are enrolled (a promo code and referral still apply) and sent straight to Maya's checkout for a paid PHP course, or to the course page with payment instructions otherwise; a free course enrols and opens. Logged-out visitors sign up and come back to this route (the return-to-course cookie is extended to allow exactly this one extra path). A short sign-up (name, email, password, terms) creates a talent account with the rest of the profile deferred to profile completion. No Google login (the app has none).

**Referral links.** `?ref=` on any public page (catalog, category, course, coach) sets the cookie through the existing affiliate logic, then the code is removed from the address bar (`history.replaceState`); canonical addresses never include it. "Share this course" copies the course link with the member's own code (members who are not eligible, or signed out, get the clean link).

**Admin.** The existing approvals queue gains Reject with a reason; categories stay where they are; a Feature toggle with an order on the course list; reviews can be hidden.

## 3. Decisions needed

1. **Visibility model.** Keep `status` plus a new LISTED/UNLISTED choice (recommended, avoids a second lifecycle) rather than replacing status with draft/unlisted/published.
2. **Existing published courses become public in the catalog** when this ships (recommended; each can be unlisted first).
3. **Approval:** add reject-with-reason and the setting `academy.requireApproval` (default on); when off a coach publishes their own course.
4. **New tables:** `CoachProfile`, `CourseReview`, `SlugRedirect`, plus the new course columns.
5. **Coach identity:** a coach profile replaces the email prefix everywhere; coaches are public only when they switch it on and have a listed course.
6. **Reviews:** any current owner can review once (verified buyer), shown as first name and last initial; staff can hide with a reason. Alternative: only after finishing the course.
7. **Caching:** cached public HTML plus a small client island for the visitor-specific parts (recommended).
8. **Buying flow:** a new `/courses/<id>/buy` route that enrols and goes straight to Maya for paid PHP courses; the return cookie allows that one extra path. Onboarding locks still apply (a talent who must watch the welcome video first is sent there).
9. **Short sign-up:** name, email, password and terms, with the rest of the talent profile completed later. This changes how talent accounts are created, so I want your explicit yes.
10. **Coaches and referral codes:** make coaches eligible to hold a referral code (recommended, so the Share button works for them; they could then earn the 15% commission), or give coaches the plain link without a code.
11. **Captions:** the video player has no captions field today; I would add optional caption files (WebVTT) later, not in this first release.
12. **Real domain:** confirm `APP_URL` in Vercel is your real public address; sitemap, canonicals and share cards all depend on it.

## 4. Build and rollout

Three PRs, in order: (1) data and rules: slugs, listing, content fields, coach profiles, reviews, approval and reject, featured, settings, with tests; (2) the public pages: catalog, course, category and coach pages, SEO (sitemap, robots, canonicals, Open Graph, JSON-LD), caching, stable thumbnails, referral capture everywhere and the Share button; (3) the buying flow and short sign-up. Additive migrations only (one data step generates slugs for existing courses); no new environment variables. I would run each migration only when you ask.
