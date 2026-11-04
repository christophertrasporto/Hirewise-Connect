import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { catalogHref, type CatalogQuery } from "@/lib/public-catalog";
import { cn } from "@/lib/cn";

/** Previous, next and numbered links for the catalog. Each page is its own address, so the view can be shared. */
export function Pagination({ basePath, query, page, pages }: { basePath: string; query: CatalogQuery; page: number; pages: number }) {
  if (pages <= 1) return null;
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  const href = (n: number) => catalogHref(basePath, { ...query, page: n });
  const item = "inline-flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-[13.5px] font-semibold transition";
  return (
    <nav aria-label="Pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={cn(item, "border-ink-200 bg-white text-ink-800 hover:border-ink-300")}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Link>
      ) : null}
      {numbers.map((n, i) => (
        <span key={n} className="inline-flex items-center gap-2">
          {i > 0 && n - numbers[i - 1] > 1 ? <span aria-hidden="true" className="text-ink-400">…</span> : null}
          <Link href={href(n)} aria-current={n === page ? "page" : undefined} className={cn(item, n === page ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-800 hover:border-ink-300")}>
            {n}
          </Link>
        </span>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={cn(item, "border-ink-200 bg-white text-ink-800 hover:border-ink-300")}>
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}
