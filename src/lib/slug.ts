/**
 * Address segments for the public Academy (`/academy/<course-slug>`, `/coaches/<coach-slug>`).
 * A slug is lower-case letters and digits separated by single hyphens, at most 80 characters.
 */

export const SLUG_MAX = 80;

/** Words that already mean something in a public path, so no course or coach may take them. */
export const RESERVED_SLUGS = ["category", "courses", "new", "search", "api", "admin", "coaches", "academy", "buy"] as const;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/** Why a typed slug is not allowed, or null when it is. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > SLUG_MAX) return `Use at most ${SLUG_MAX} characters.`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "Use lower-case letters, digits and single hyphens.";
  if (isReservedSlug(slug)) return "That word is reserved. Choose another.";
  return null;
}

/** A base that is always a valid slug: the text, or the fallback when the text leaves nothing, never a reserved word. */
export function baseSlug(text: string, fallback: string): string {
  const s = slugify(text) || fallback;
  return isReservedSlug(s) ? `${s}-${fallback}` : s;
}

/** `base`, then `base-2`, `base-3`... until `taken` says it is free. The suffix is kept inside the length limit. */
export async function firstFreeSlug(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Could not find a free address for this name.");
}
