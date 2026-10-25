/** Course cover helpers shared by the server (validation) and the Academy components (generated covers). */

export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_MIMES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type CoverMime = keyof typeof COVER_MIMES;

/** Covers are marketing images of published courses, so their signed links live longer than private media links. */
export const COVER_URL_TTL_SECONDS = 60 * 60;

export function coverKeyPrefix(courseId: string) {
  return `courses/${courseId}/cover/`;
}

/** Accent colors for generated covers, drawn from the Hirewise palette and a few cool neighbors. */
const ACCENTS = ["#0ea47a", "#e8b44c", "#38bdf8", "#a78bfa", "#fb7185", "#2dd4bf"] as const;

/** Stable accent per category so a category always looks the same across the catalog. */
export function coverAccent(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

export function difficultyLabel(d: string | null | undefined): string | null {
  if (!d) return null;
  return d.charAt(0) + d.slice(1).toLowerCase();
}
