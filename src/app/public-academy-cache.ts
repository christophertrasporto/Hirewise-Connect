import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/server/db/client";
import { getCatalog, getCatalogCategories, getCategory, getPublicCoachPage, getPublicCoursePage, sitemapEntries } from "@/server/services/public-catalog.service";
import type { CatalogQuery } from "@/lib/public-catalog";

/**
 * Cached reads for the public Academy pages. Public pages read no cookies, so everyone sees the same HTML; the data comes
 * through here and is refreshed when a course, coach, review or category changes (the actions call `revalidatePublicAcademy`)
 * and, as a fallback, every five minutes. Anything specific to the visitor loads separately, after the page, with no cache.
 */

export const PUBLIC_ACADEMY_TAG = "public-academy";
const OPTIONS = { tags: [PUBLIC_ACADEMY_TAG], revalidate: 300 };

export function revalidatePublicAcademy() {
  revalidateTag(PUBLIC_ACADEMY_TAG);
}

export const cachedCatalog = unstable_cache((query: CatalogQuery, withFeatured: boolean) => getCatalog(prisma, query, { withFeatured }), ["public-catalog"], OPTIONS);
export const cachedCategories = unstable_cache(() => getCatalogCategories(prisma), ["public-categories"], OPTIONS);
export const cachedCategory = unstable_cache((slug: string) => getCategory(prisma, slug), ["public-category"], OPTIONS);
export const cachedCoursePage = unstable_cache((slug: string) => getPublicCoursePage(prisma, slug), ["public-course-page"], OPTIONS);
export const cachedCoachPage = unstable_cache((slug: string) => getPublicCoachPage(prisma, slug), ["public-coach-page"], OPTIONS);
export const cachedSitemap = unstable_cache(() => sitemapEntries(prisma), ["public-sitemap"], OPTIONS);
