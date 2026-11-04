"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { CATALOG_LEVELS, CATALOG_SORTS, CATALOG_SORT_LABELS, type CatalogQuery } from "@/lib/public-catalog";
import { inputBase, inputOk } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

const control = cn(inputBase, inputOk, "h-11 w-full");

/**
 * Search, filters and sort for the public catalog. It is a plain GET form, so it works without scripts and every choice
 * ends up in the address; with scripts, changing a filter applies it at once. Applying always starts again at page 1.
 */
export function CatalogFilters({ basePath, query, categories }: { basePath: string; query: CatalogQuery; /** Omitted on a category page, where the category is fixed. */ categories?: Array<{ name: string; slug: string; count: number }> }) {
  const form = useRef<HTMLFormElement>(null);
  const [price, setPrice] = useState(query.price);
  const active = !!query.q || (!!query.category && !!categories) || query.price !== "any" || !!query.level || query.preview || query.sort !== "popular";
  const apply = () => form.current?.requestSubmit();

  return (
    <form
      ref={form}
      method="get"
      action={basePath}
      role="search"
      aria-label="Search and filter courses"
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "SELECT" || t.type === "checkbox") apply();
      }}
      className="space-y-4 rounded-3xl border border-ink-100 bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search courses</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input type="search" name="q" defaultValue={query.q} maxLength={80} placeholder="Search by course, topic or coach" className={cn(control, "pl-10")} />
        </label>
        <button type="submit" className="inline-flex h-11 items-center justify-center rounded-full bg-ink-900 px-6 text-[14px] font-semibold text-white hover:bg-ink-800">
          Search
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories && (
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-600">Category</span>
            <select name="category" defaultValue={query.category ?? ""} className={control}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-600">Level</span>
          <select name="level" defaultValue={query.level ?? ""} className={control}>
            <option value="">Any level</option>
            {CATALOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.charAt(0) + l.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-600">Price</span>
          <select name="price" value={price} onChange={(e) => setPrice(e.target.value as typeof price)} className={control}>
            <option value="any">Any price</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-600">Sort by</span>
          <select name="sort" defaultValue={query.sort} className={control}>
            {CATALOG_SORTS.map((s) => (
              <option key={s} value={s}>
                {CATALOG_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {price === "paid" && (
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-600">Price from</span>
              <input type="number" name="min" min={0} step="1" inputMode="decimal" defaultValue={query.min ?? ""} className={cn(control, "w-28")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-600">to</span>
              <input type="number" name="max" min={0} step="1" inputMode="decimal" defaultValue={query.max ?? ""} className={cn(control, "w-28")} />
            </label>
            <button type="submit" className="h-11 rounded-full border border-ink-200 px-4 text-[13px] font-semibold text-ink-800 hover:border-ink-300">
              Apply
            </button>
          </div>
        )}
        <label className="inline-flex h-11 items-center gap-2 text-[14px] text-ink-700">
          <input type="checkbox" name="preview" value="1" defaultChecked={query.preview} className="h-4 w-4 rounded border-ink-300 accent-brand-500" />
          Has a free preview
        </label>
        {active && (
          <Link href={basePath} className="inline-flex h-11 items-center gap-1 text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">
            <X className="h-4 w-4" aria-hidden="true" /> Clear all
          </Link>
        )}
      </div>
    </form>
  );
}
