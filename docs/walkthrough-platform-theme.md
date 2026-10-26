# Platform theme: backgrounds and dark mode

Built 2026-10-26 from `docs/plan-platform-theme.md`. Visual change only: no migration, no new environment variables, no new permissions.

## What changed

| Area | Background |
| --- | --- |
| Marketing (`(marketing)`) | `bg-hero` on the home hero and every page hero (brand and gold glows over a cool-to-white fade, a drifting soft blob, the faint grid). `bg-band` on alternating sections (a mist-to-page gradient with a hairline on top). `bg-navy` on the control section and the closing call to action. |
| Sign-in and sign-up (`(auth)`) | The brand panel is `bg-navy` with two slowly drifting glows. The form side is `bg-app` instead of plain white. |
| App for talent, clients, agencies | `bg-app`: a barely tinted page with a soft brand glow at the top and a hint of gold in the corner. Calm on purpose. |
| Staff console | `bg-staff`: the same shell on a flat, cooler neutral with tighter vertical padding. `AppShell` takes `tone="app" or "staff"`; `(app)/layout.tsx` picks staff for every role that is not talent, client, applicant, or agency. |
| Gate pages (`(gate)`) | `bg-app` with a translucent header. |

All backgrounds are CSS variables (`--page-bg`, `--app-base`, `--staff-base`, `--band-base`, `--hero-top`, `--glow-*`, `--hairline`, `--glass-bg`) declared in `src/app/globals.css`. A theme is a block of variables, so a new mood is a new block, not a rewrite.

Motion is one keyframe, `drift` (28 s, alternating, a few percent of movement). The existing reduced-motion block clamps every animation, so it stops for people who ask for that.

## Dark theme

- The switch (`ThemeToggle`) is in the marketing header, the app header, the gate header, and both auth layouts. It offers Light, Dark, and "Use my device setting". The choice lives in the `hw_theme` cookie (one year, not secret, readable by script); "device setting" clears the cookie and follows the operating system live.
- `<html data-theme="dark" | "light">` is set by a tiny inline script in `<head>` before first paint (`THEME_INIT_SCRIPT` in `src/lib/theme.ts`). The root layout never reads the cookie on the server, so marketing pages stay static.
- Colours are not remapped by inverting the `ink` scale, because the same token is text on one surface and a dark panel on another. Instead `scripts/gen-dark-theme.ts` scans `src` for the colour classes in use (including `hover:`, `focus:`, `group-hover:`, `placeholder:`, `disabled:`, `open:`, `has-[:checked]:`) and writes `src/app/dark-theme.css` from the palette in `src/lib/dark-theme-palette.ts`. No page was edited to support dark mode.
- Panels that are already dark in the light theme keep their light-on-dark text. Filled controls (`bg-ink-900 text-white` buttons and chips on `a`, `button`, `span`, `label`, `input`) become brand green in dark, and solid `bg-brand-500` and `bg-brand-600` fills darken one step so white text clears 4.5:1.
- `dark:` utilities are available too (`@custom-variant dark` follows the same attribute).

## After adding colour classes

```bash
npm run theme:gen
```

`tests/unit/theme.test.ts` fails when `src/app/dark-theme.css` is stale, or when the generator meets a colour utility or variant it does not handle (it stops instead of leaving a silent gap).

## Tests

- Cookie value handling, device-setting resolution, and the init script (saved choice, tampered cookie, blocked storage) run without a browser.
- The generated stylesheet matches the generator output.
- WCAG AA (4.5:1) for every dark text token on the four dark surfaces, status text on its own tint, white on filled controls and brand fills.

## Checked in the browser

Contrast scan (every visible text node against its blended background) in dark: 0 failures across the home page, For clients, For talent, Academy, How it works, About, Contact, Legal, sign-in, and the talent app pages (Dashboard, Profile, Video and voice, Opportunities, Interviews, Placements, Courses, Refer, Messages, Report a bypass, Apply for Agency, Agreements, Notifications). Phone, tablet, and desktop widths in both themes.

Known and not caused by this change (light theme, unchanged): muted captions in `text-ink-400` are 3.2 to 3.5:1 on white and the pale page, white text on the `brand-500` hero and header buttons is 3.2:1, and decorative step numerals are about 2:1. The dark theme does not have these. Darkening `ink-400` and moving primary buttons to `brand-600` would fix them in light; that is a separate, visible change to the brand look, so it was left for a decision.

## Not done

Per-user custom colours, a theme editor, a new logo or palette, and print styles stay out of scope. Email templates keep their own inline light styling.
