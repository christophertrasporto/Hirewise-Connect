"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { seg: "", label: "Overview" },
  { seg: "team", label: "My team" },
  { seg: "training", label: "Training" },
  { seg: "opportunities", label: "Opportunities" },
  { seg: "reports", label: "Reports" },
  { seg: "settings", label: "Settings" },
];

/** The six Agency Owner portal sections. */
export function AgencyTabs() {
  const pathname = usePathname();
  const rest = pathname.startsWith("/agency") ? pathname.slice("/agency".length).replace(/^\//, "") : "";
  const current = rest.split("/")[0];
  return (
    <nav className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Agency sections">
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {TABS.map((t) => (
          <Link key={t.seg} href={t.seg ? `/agency/${t.seg}` : "/agency"} className={cn("whitespace-nowrap rounded-full border px-4 py-1.5 text-[13.5px] font-semibold", current === t.seg ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")} aria-current={current === t.seg ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
