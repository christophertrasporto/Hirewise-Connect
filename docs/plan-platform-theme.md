# Platform-wide background themes: findings and plan

Request 2026-10-26: "create better background themes for the entire platform." Nothing is built yet. The course catalog redesign (PR #20) already introduced Academy-only tokens and said the rest of the platform would follow once the look was approved; this is that pass.

## 1. What the platform looks like today

| Area | Layout | Background today |
| --- | --- | --- |
| Marketing site (`(marketing)`) | home, for clients, for talent, academy, how it works, about, contact, legal, verify | White page with a faint green wash at the top of the hero, plus a few grid-line and floating-card accents (`grid-bg`, `animate-float`). Flat below the hero. |
| Sign-in and sign-up (`(auth)`) | split screen | A dark navy panel with a fine grid on the left, plain white on the right. The strongest look on the platform. |
| App (`(app)`) for talent, clients, agencies | sidebar and header shell | Page is a flat pale grey (`ink-50` at 60%) with white cards; the sidebar and header are plain white. |
| Staff console | same app shell | Same as the app. |
| Gate pages (`(gate)`) | onboarding and terms gates | Same flat treatment. |

Facts that shape the plan:
- Colors are Tailwind v4 tokens in `globals.css` (`ink` navy scale, `brand` green, `gold`), so backgrounds can be changed in one place.
- There is no dark mode. Pages use about 180 `bg-white` and 130 `bg-ink-50` classes, so a dark theme means remapping tokens, not editing each page.
- The Academy already has `surface`, `radius-card`, `shadow-card`, and a navy `cover-navy` look that can become the platform vocabulary.

## 2. Proposed design

**One background system, four moods, driven by CSS variables.** A small set of page-level tokens (`--page-bg`, `--panel-bg`, `--sidebar-bg`, `--header-bg`, `--hero-bg`) so a theme is a block of variables, not a rewrite.

- **Marketing (expressive):** a layered hero background (soft brand-green and gold radial glows over a cool white-to-mist gradient, with a very faint grid that fades out), gentle section banding below it so the page stops being flat white, and a navy section for the proof and call-to-action bands. Motion only as a slow drift, off under reduced motion.
- **Auth (brand panel):** keep the navy panel and make it richer: the same glow and grid system, a subtle animated gradient, and the Academy-style stat chips. The form side gets a soft panel instead of plain white.
- **App (calm):** a barely tinted page with a very soft top glow, white cards that lift slightly (the Academy card shadow), and a refined sidebar and header with a hairline gradient. Calm on purpose: people work here all day.
- **Staff console (dense and neutral):** the same shell without the glow, a cooler neutral page, and tighter surfaces, so staff screens read as tools and stay fast to scan.

**Dark theme.** Remap the `ink` scale and surface tokens under a `data-theme="dark"` attribute (deep navy page, raised navy panels, the same green and gold accents), with a theme switch in the app header and on the marketing nav. It follows the system setting by default and remembers the choice in a cookie so there is no flash on load. Every status color, chip, banner, form field, and chart gets a contrast check (WCAG AA) in both themes.

**Out of scope:** per-user custom colors, a theme editor, brand re-skinning (new logo, new palette), and print styles.

## 3. Build plan (one PR, in this order)

1. Tokens and background utilities in `globals.css` (page, panel, sidebar, header, hero, glow, grain), plus the theme attribute handling in the root layout.
2. App shell, gate pages, and staff console.
3. Marketing site and auth pages.
4. Dark theme: token remap, switch, no-flash cookie, and a sweep of components that hard-code white or navy text.
5. Screenshots of each area at phone, tablet, and desktop widths in both themes; fix contrast failures; tests for the theme cookie handling and a check that no page loses text contrast.

## 4. Decisions to confirm

1. **Scope**: a refined default look plus a dark theme with a switch (recommended). Alternatives: the refined default only, or several named themes users can pick (more work and more to maintain).
2. **Areas**: all four above (recommended), or marketing and auth only.
3. **Brand direction**: keep the navy, green, and gold identity and make it richer (recommended), or a new palette (then send me your colors or brand guide).
4. **Motion**: slow, subtle background drift that stops under reduced motion (recommended), or fully static.
5. **Theme choice**: follow the system setting by default and remember the switch in a cookie (recommended), or always light unless chosen.
6. **Staff console**: a calmer, denser variant (recommended), or identical to the app.

## 5. Rollout

No migration and no new environment variables. Visual change only, shipped behind the normal review: you can compare it on the PR's Vercel preview before merging.
