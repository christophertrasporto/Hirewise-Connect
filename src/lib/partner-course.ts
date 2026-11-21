/**
 * Partner courses: a course taught on another site and reached through an affiliate link. The link is stored on the
 * course but is never part of a public view or a page; visitors press `/go/<slug>`, which logs the click and redirects.
 * Pure rules only (no database): what a valid link is, what a partner course needs before it can go live, and the words
 * shown to visitors.
 */

export const PARTNER_BUTTON_LABEL = "Take this course";

/**
 * The short notice shown beside every partner course button. It is a plain transparency sentence, not legal text; counsel
 * should confirm the wording before launch.
 */
export const PARTNER_DISCLOSURE = "This course is taught on a partner's site. Hirewise may earn a commission if you buy through this link, at no extra cost to you.";

const MAX_URL = 2000;

export type PartnerLinkResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * A partner link must be a full https address with a real host: no other scheme (so never `javascript:` or `data:`), no
 * embedded user name or password, no localhost or private address, and no address on this site itself.
 */
export function parsePartnerUrl(raw: unknown, ownOrigin?: string): PartnerLinkResult {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: "Enter the partner link." };
  const text = raw.trim();
  if (text.length > MAX_URL) return { ok: false, message: "That link is too long." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, message: "Enter a full link that starts with https://" };
  }
  if (u.protocol !== "https:") return { ok: false, message: "The partner link must start with https://" };
  if (u.username || u.password) return { ok: false, message: "The link cannot contain a user name or password." };
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, message: "Enter the partner's public web address." };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, message: "Use the partner's web address, not an IP address." };
  if (ownOrigin) {
    try {
      if (new URL(ownOrigin).hostname.toLowerCase() === host) return { ok: false, message: "The link must go to another site, not Hirewise." };
    } catch {
      // an unusable own origin cannot match anything
    }
  }
  return { ok: true, url: u.toString() };
}

/** The partner name and the price text, trimmed and length-limited; an empty price text means none is shown. */
export function cleanPartnerText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** A partner course is one with a stored link. */
export function isPartnerCourse(c: { externalUrl?: string | null }): boolean {
  return !!c.externalUrl;
}

/** Why a partner course cannot go live yet, or null when it is ready (a link, the partner's name, and a cover image). */
export function partnerPublishProblem(c: { externalUrl?: string | null; externalProvider?: string | null; thumbnailKey?: string | null; hasCover?: boolean }): string | null {
  if (!c.externalUrl) return "Add the partner link first.";
  if (!c.externalProvider) return "Add the partner's name (for example Udemy) before this course goes live.";
  if (!c.thumbnailKey && !c.hasCover) return "Add a cover image before this course goes live, so it looks right in the catalog.";
  return null;
}

/** The only address the public pages link to. */
export function partnerGoPath(slug: string): string {
  return `/go/${slug}`;
}

/** What a partner card or page shows in place of a price: the typed price text, else who sells it. */
export function partnerPriceText(provider: string | null, priceLabel: string | null): string {
  return priceLabel || (provider ? `On ${provider}` : "Partner course");
}
