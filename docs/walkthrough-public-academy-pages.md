# Public Academy part 2: the public pages

Plan: `docs/plan-public-academy.md` (part 1 was the data layer; part 3, the buy flow and short sign-up, is still to do).

## Addresses

| Address | What |
|---|---|
| `/academy` | Catalog: search, category chips, filters (category, level, price, has a free preview), five sorts, 12 per page, a featured row on the plain first page. Every choice is in the URL. |
| `/academy/category/[slug]` | The same catalog fixed to one category. |
| `/academy/[slug]` | A course: lazy free preview, sticky Buy card (a bar along the bottom on phones), what you will learn, curriculum with locks, more free lessons, coach cards, reviews, refunds line, FAQ, related courses. |
| `/coaches/[slug]` | A coach: photo, headline, bio, links, learners, rating, their listed courses. Live only while the coach has switched it on and has a published, listed course. |
| `/academy/courses/<id>` | The old id address. Answers 301 to the slug, keeping the query (an old `?ref=` link still works). |
| `/sitemap.xml`, `/robots.txt` | Listed courses, categories with a listed course, live coaches. Robots blocks signed-in, financial and internal paths. |

A retired course or coach address redirects to the current one (308). A draft or archived course is a 404; an unlisted course opens by its address with `noindex` and is left out of every list, search, related row and the sitemap.

## Who sees what

The pages read no cookies, so they are cached (refreshed when a course, coach, review or category changes, and at least every five minutes) and identical for everyone. The visitor-specific parts load afterwards from `/api/academy/viewer` with no caching: Buy course, Complete your payment or Continue learning; the owner's own review form; and whether Share carries a referral code. Coaches are named only when their page is live (never the part of an email before the `@`). A gated lesson never carries its body, link or file.

## Images

Cover images and coach photos are private files. Pages use stable addresses, `/api/academy/thumbnail/<courseId>?v=` and `/api/coach-photo/<slug>?v=`, which answer with a short-lived signed redirect, cached for a few minutes. Drafts have no public cover; a coach photo is public only while the coach page is live (the coach and course managers see it before that). Coaches add a photo at Coach profile (choose, preview, Save photo).

## Referral and sharing

`?ref=CODE` on any public page is posted to `/api/referral/capture` (the existing affiliate logic), then removed from the address bar; canonical addresses never carry it. Share copies the page address, with the member's own code when the visitor is a talent, coach or agency owner (`/api/academy/share`), otherwise the clean address.

## Reviews

A learner who owns the course gets a "Rate this course" form on its page. The review shows as first name and last initial; Admin can hide one with a reason (part 1).

## To switch on in production

`APP_URL` in Vercel must be the real public domain: canonical addresses, the sitemap, share cards and share links are all built from it.
