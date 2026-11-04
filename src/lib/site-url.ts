/**
 * The public address of the site, from `APP_URL` (or Vercel's production domain when it is not set). Sitemap entries,
 * canonical addresses, Open Graph images and share links are all built from it, so it must be the real domain.
 * Reads `process.env` directly so pages that never touch the server layer can still build their metadata.
 */

const LOCAL = "http://localhost:3000";

export function siteUrl(): string {
  const configured = process.env.APP_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = configured || (vercel ? `https://${vercel}` : LOCAL);
  try {
    return new URL(raw).origin;
  } catch {
    return LOCAL;
  }
}

/** An absolute address for a path on this site (`/academy` becomes `https://example.com/academy`). */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
