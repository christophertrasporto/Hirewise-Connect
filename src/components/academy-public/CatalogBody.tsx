import Link from "next/link";
import { SearchX, Sparkles } from "lucide-react";
import { CatalogGrid } from "./CatalogCard";
import { CatalogFilters } from "./CatalogFilters";
import { Pagination } from "./Pagination";
import { catalogHref, type CatalogQuery } from "@/lib/public-catalog";
import type { CatalogView as CatalogData, CatalogCategory } from "@/server/services/public-catalog.service";
import { cn } from "@/lib/cn";

/**
 * The shared body of the public catalog and of a category page: filters, category chips, the featured row, the results with
 * a count, pagination, and designed empty states (nothing published yet, or nothing matches the filters).
 */
export function CatalogBody({ basePath, query, data, categories, fixedCategory }: { basePath: string; query: CatalogQuery; data: CatalogData; categories: CatalogCategory[]; /** Set on a category page. */ fixedCategory?: string }) {
  const filtered = !!query.q || !!query.level || query.price !== "any" || query.preview || (!fixedCategory && !!query.category);
  return (
    <div className="space-y-8">
      <CatalogFilters basePath={basePath} query={query} categories={fixedCategory ? undefined : categories} />

      {categories.length > 0 && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2">
          <Link href="/academy" aria-current={!fixedCategory && !query.category ? "page" : undefined} className={chip(!fixedCategory && !query.category)}>
            All
          </Link>
          {categories.map((c) => {
            const on = fixedCategory === c.slug || (!fixedCategory && query.category === c.slug);
            return (
              <Link key={c.slug} href={`/academy/category/${c.slug}`} aria-current={on ? "page" : undefined} className={chip(on)}>
                {c.name} <span className="text-ink-400">{c.count}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {data.featured.length > 0 && (
        <section aria-labelledby="featured-heading">
          <h2 id="featured-heading" className="mb-4 inline-flex items-center gap-2 text-[1.35rem] font-bold">
            <Sparkles className="h-5 w-5 text-gold-500" aria-hidden="true" /> Featured courses
          </h2>
          <CatalogGrid courses={data.featured} />
        </section>
      )}

      <section aria-labelledby="results-heading">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="text-[1.35rem] font-bold">
            {data.featured.length > 0 ? "All courses" : filtered ? "Results" : "Courses"}
          </h2>
          <p className="text-[13.5px] text-ink-500" aria-live="polite">
            {data.total === 0 ? "No courses" : `${data.total} course${data.total === 1 ? "" : "s"}`}
            {data.pages > 1 ? `, page ${data.page} of ${data.pages}` : ""}
          </p>
        </div>

        {data.total === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
            <SearchX className="mx-auto h-9 w-9 text-ink-300" aria-hidden="true" />
            {filtered ? (
              <>
                <h3 className="mt-4 text-[18px] font-bold text-ink-900">No courses match those filters</h3>
                <p className="mx-auto mt-2 max-w-md text-[14.5px] text-ink-500">Try a different word, a broader price range, or clear the filters to see everything.</p>
                <Link href={fixedCategory ? basePath : catalogHref("/academy", {})} className="mt-5 inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-[14px] font-semibold text-white hover:bg-ink-800">
                  Clear filters
                </Link>
              </>
            ) : (
              <>
                <h3 className="mt-4 text-[18px] font-bold text-ink-900">Courses are on the way</h3>
                <p className="mx-auto mt-2 max-w-md text-[14.5px] text-ink-500">Our coaches are publishing their first courses. Check back soon, or create a talent account to be ready when they land.</p>
                <Link href="/register?as=talent" className="mt-5 inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-[14px] font-semibold text-white hover:bg-ink-800">
                  Create a talent account
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <CatalogGrid courses={data.cards} />
            <Pagination basePath={basePath} query={fixedCategory ? { ...query, category: null } : query} page={data.page} pages={data.pages} />
          </>
        )}
      </section>
    </div>
  );
}

function chip(on: boolean) {
  return cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300");
}
