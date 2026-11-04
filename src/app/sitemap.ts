import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { cachedCategories, cachedSitemap } from "@/app/public-academy-cache";

export const revalidate = 3600;

/**
 * Public pages for search engines: the marketing pages, the Academy catalog, every published and listed course, every
 * category that has a listed course, and every live coach page. Unlisted courses, drafts and archived courses are never
 * included. The data comes from the same cache as the pages, so a change shows up in the sitemap when the pages refresh.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed = ["/", "/academy", "/for-clients", "/for-talent", "/how-it-works", "/about", "/contact"].map((path) => ({ url: absoluteUrl(path), changeFrequency: "weekly" as const, priority: path === "/" || path === "/academy" ? 1 : 0.6 }));
  let dynamic: MetadataRoute.Sitemap = [];
  try {
    const [entries] = await Promise.all([cachedSitemap(), cachedCategories()]);
    dynamic = entries.map((e) => ({
      url: absoluteUrl(e.path),
      lastModified: new Date(e.updatedAt),
      changeFrequency: "weekly" as const,
      priority: e.path.startsWith("/academy/category/") ? 0.5 : 0.8,
    }));
  } catch {
    // A database outage should still leave the fixed pages in the sitemap.
  }
  return [...fixed, ...dynamic];
}
