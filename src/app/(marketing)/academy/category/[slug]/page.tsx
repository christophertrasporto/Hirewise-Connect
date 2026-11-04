import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { CatalogBody } from "@/components/academy-public/CatalogBody";
import { JsonLd } from "@/components/academy-public/JsonLd";
import { cachedCatalog, cachedCategories, cachedCategory } from "@/app/public-academy-cache";
import { catalogHref, parseCatalogQuery } from "@/lib/public-catalog";
import { breadcrumbLd, catalogLd, publicMetadata } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(slug: string, raw: Record<string, string | string[] | undefined>) {
  const category = await cachedCategory(slug);
  if (!category) return null;
  const query = { ...parseCatalogQuery(raw), category: category.slug };
  const [data, categories] = await Promise.all([cachedCatalog(query, false), cachedCategories()]);
  return { category, query, data, categories };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await cachedCategory(slug);
  if (!category) return { title: "Category not found", robots: { index: false } };
  const q = parseCatalogQuery(await searchParams);
  const plain = !q.q && !q.level && q.price === "any" && !q.preview && q.sort === "popular";
  const base = `/academy/category/${category.slug}`;
  return publicMetadata({
    title: `${category.name} courses`,
    description: `Online ${category.name.toLowerCase()} courses from Hirewise coaches. Watch a free preview, learn at your pace, and add certifications to your Connect profile.`,
    path: plain ? catalogHref(base, { page: q.page }) : base,
    noindex: !plain,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const loaded = await load(slug, await searchParams);
  if (!loaded) notFound();
  const { category, query, data, categories } = loaded;
  const basePath = `/academy/category/${category.slug}`;

  return (
    <>
      <ReferralCapture />
      <JsonLd data={breadcrumbLd([{ name: "VA Academy", path: "/academy" }, { name: category.name, path: basePath }])} />
      <JsonLd data={catalogLd(`${category.name} courses`, basePath, data.cards)} />
      <section className="border-b border-ink-100 bg-hero">
        <div className="container-x py-12 lg:py-16">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ink-500">
            <Link href="/academy" className="hover:text-ink-800">
              VA Academy
            </Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-current="page" className="font-semibold text-ink-800">
              {category.name}
            </span>
          </nav>
          <h1 className="mt-4 text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-[2.8rem]">{category.name} courses</h1>
          <p className="mt-3 max-w-2xl text-[16.5px] leading-relaxed text-ink-500">Courses in {category.name.toLowerCase()} from Hirewise coaches. Watch a free preview before you decide.</p>
        </div>
      </section>
      <section className="py-14 lg:py-20">
        <div className="container-x">
          <CatalogBody basePath={basePath} query={query} data={data} categories={categories} fixedCategory={category.slug} />
        </div>
      </section>
    </>
  );
}
