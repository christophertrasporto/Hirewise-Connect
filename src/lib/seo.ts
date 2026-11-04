import type { Metadata } from "next";
import { absoluteUrl, siteUrl } from "@/lib/site-url";

/**
 * Search and sharing for the public Academy pages: the page metadata (canonical address, robots, Open Graph, Twitter) and
 * the structured data (JSON-LD). Everything is built from the site address (`APP_URL`), and a canonical address never
 * carries a `ref` code or any other query, so a shared link and the page itself count as one page.
 */

const BRAND = "Hirewise Connect";

export function publicMetadata(p: { title: string; description: string; path: string; image?: string | null; noindex?: boolean; type?: "website" | "profile" }): Metadata {
  const url = absoluteUrl(p.path);
  const image = p.image ? [{ url: p.image.startsWith("http") ? p.image : absoluteUrl(p.image) }] : undefined;
  const description = p.description.replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    title: p.title,
    description,
    alternates: { canonical: url },
    robots: p.noindex ? { index: false, follow: true } : undefined,
    openGraph: { title: `${p.title} · ${BRAND}`, description, url, siteName: BRAND, type: p.type === "profile" ? "profile" : "website", images: image },
    twitter: { card: image ? "summary_large_image" : "summary", title: `${p.title} · ${BRAND}`, description, images: image?.map((i) => i.url) },
  };
}

/** Serialised for a <script type="application/ld+json"> tag. `<` is escaped so page text can never close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function breadcrumbLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

const organization = () => ({ "@type": "Organization", name: BRAND, url: siteUrl() });

export function courseLd(c: {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  priceCents: number;
  currency: string;
  image: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  coaches: Array<{ name: string; slug: string | null }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: c.title,
    description: c.description.replace(/\s+/g, " ").trim().slice(0, 500),
    url: absoluteUrl(`/academy/${c.slug}`),
    provider: organization(),
    educationalLevel: c.difficulty.charAt(0) + c.difficulty.slice(1).toLowerCase(),
    ...(c.image ? { image: c.image.startsWith("http") ? c.image : absoluteUrl(c.image) } : {}),
    offers: { "@type": "Offer", category: c.priceCents === 0 ? "Free" : "Paid", price: (c.priceCents / 100).toFixed(2), priceCurrency: c.currency, availability: "https://schema.org/InStock", url: absoluteUrl(`/academy/${c.slug}`) },
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: "Self-paced" },
    ...(c.ratingCount > 0 && c.ratingAverage !== null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: c.ratingAverage, ratingCount: c.ratingCount, bestRating: 5, worstRating: 1 } } : {}),
    ...(c.coaches.length ? { instructor: c.coaches.map((p) => ({ "@type": "Person", name: p.name, ...(p.slug ? { url: absoluteUrl(`/coaches/${p.slug}`) } : {}) })) } : {}),
  };
}

export function coachLd(p: { slug: string; displayName: string; headline: string | null; bio: string | null; photoUrl: string | null; links: Array<{ url: string }> }) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: p.displayName,
    url: absoluteUrl(`/coaches/${p.slug}`),
    ...(p.headline ? { jobTitle: p.headline } : {}),
    ...(p.bio ? { description: p.bio.replace(/\s+/g, " ").trim().slice(0, 500) } : {}),
    ...(p.photoUrl ? { image: absoluteUrl(p.photoUrl) } : {}),
    ...(p.links.length ? { sameAs: p.links.map((l) => l.url) } : {}),
    worksFor: organization(),
  };
}

export function catalogLd(name: string, path: string, cards: Array<{ slug: string; title: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: absoluteUrl(path),
    mainEntity: { "@type": "ItemList", itemListElement: cards.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(`/academy/${c.slug}`), name: c.title })) },
  };
}
