/**
 * Dark theme palette. Pure data: `scripts/gen-dark-theme.ts` turns it into `src/app/dark-theme.css`, and
 * `tests/unit/theme.test.ts` checks every text/background pairing against WCAG AA. Colour values are hex or
 * `rgb(r g b / a)` so the test can blend translucent tints over the surface they sit on.
 */

/** Surfaces, darkest to lightest. `panel` is what `bg-white` becomes (cards, sidebar, header). */
export const DARK_SURFACES = {
  page: "#070e1b",
  sunken: "#0b1527",
  panel: "#0e192c",
  raised: "#15233b",
  /** Navy sections and panels that are already dark in the light theme. */
  navy: "#0d1c33",
} as const;

/** Text colour classes: light-theme token -> dark value. Tokens not listed (ink-100..300, white) keep their light-on-dark values. */
export const DARK_TEXT: Record<string, string> = {
  "ink-400": "#8f9db6",
  "ink-500": "#a1afc6",
  "ink-600": "#b6c2d6",
  "ink-700": "#c9d3e3",
  "ink-800": "#dde4ef",
  "ink-900": "#f1f5fb",
  "ink-950": "#f8fafd",
  "brand-500": "#34c996",
  "brand-600": "#45d1a1",
  "brand-700": "#5fdcb0",
  "brand-800": "#8fe3c3",
  "gold-600": "#e8b44c",
  "gold-700": "#f0c46a",
  "gold-800": "#f6d78c",
  "red-500": "#ff8585",
  "red-600": "#ff8f8f",
  "red-700": "#ffa6a6",
  "red-800": "#ffbcbc",
  "orange-700": "#ffb27a",
};

/** Background colour classes. Translucent tints sit on a panel or the page, so they stay readable on either. */
export const DARK_BG: Record<string, string> = {
  white: DARK_SURFACES.panel,
  "ink-50": DARK_SURFACES.sunken,
  "ink-100": DARK_SURFACES.raised,
  "ink-200": "#1f3050",
  "brand-50": "rgb(14 164 122 / 0.14)",
  "brand-100": "rgb(14 164 122 / 0.22)",
  "gold-50": "rgb(232 180 76 / 0.13)",
  "gold-100": "rgb(232 180 76 / 0.2)",
  "red-50": "rgb(239 68 68 / 0.14)",
  "red-100": "rgb(239 68 68 / 0.22)",
  "orange-50": "rgb(249 115 22 / 0.14)",
  /** Solid brand fills carry white text; the light-theme green is only 3.2:1 against white, these clear 4.5:1. */
  "brand-500": "#0b8663",
  "brand-600": "#096b50",
};

/** Border, divider and ring colours. */
export const DARK_LINE: Record<string, string> = {
  "ink-100": "#1b2b45",
  "ink-200": "#27395a",
  "ink-300": "#34486b",
  "brand-200": "rgb(14 164 122 / 0.45)",
  "brand-300": "rgb(14 164 122 / 0.6)",
  "gold-200": "rgb(232 180 76 / 0.4)",
  "gold-300": "rgb(232 180 76 / 0.55)",
  "red-200": "rgb(239 68 68 / 0.4)",
  "red-300": "rgb(239 68 68 / 0.55)",
  "orange-200": "rgb(249 115 22 / 0.4)",
  /** Selected-state chips use a dark border in the light theme. */
  "ink-900": "#45d1a1",
};

/** Opacity variants of the two neutral surfaces (`bg-white/80`, `bg-ink-50/60`) keep their opacity over the dark colour. */
export const DARK_BG_RGB: Record<string, string> = { white: "14 25 44", "ink-50": "11 21 39" };

/** Filled call-to-action controls (`bg-ink-900 text-white` buttons and chips) become brand green, white text stays. */
export const DARK_CTA_BG = "#096b50";
export const DARK_CTA_BG_HOVER = "#0b8663";
export const DARK_CTA_ELEMENTS = ["a", "button", "span", "label", "input"] as const;

/** Variables redefined under `[data-theme="dark"]`. */
export const DARK_VARIABLES: Record<string, string> = {
  "--color-surface": DARK_SURFACES.sunken,
  "--color-surface-raised": DARK_SURFACES.panel,
  "--shadow-soft": "0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px -8px rgb(0 0 0 / 0.55)",
  "--shadow-lift": "0 2px 4px rgb(0 0 0 / 0.45), 0 24px 48px -16px rgb(0 0 0 / 0.7)",
  "--shadow-card": "0 1px 2px rgb(0 0 0 / 0.45), 0 8px 24px -12px rgb(0 0 0 / 0.65)",
  "--shadow-card-hover": "0 2px 4px rgb(0 0 0 / 0.5), 0 20px 40px -14px rgb(0 0 0 / 0.75)",
};
