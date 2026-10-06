"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { seg: "", label: "Overview" },
  { seg: "modules", label: "Modules & Lessons" },
  { seg: "learners", label: "Learners" },
  { seg: "progress", label: "Progress" },
  { seg: "certification", label: "Certification" },
  { seg: "settings", label: "Settings" },
];

/** The six Course Builder tabs. Lesson pages highlight "Modules & Lessons". */
export function BuilderTabs({ courseId }: { courseId: string }) {
  const pathname = usePathname();
  const base = `/courses/manage/${courseId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : "";
  const current = rest.startsWith("lessons") ? "modules" : rest.split("/")[0];
  return (
    <nav className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Course sections">
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {TABS.map((t) => (
          <Link key={t.seg} href={t.seg ? `${base}/${t.seg}` : base} className={cn("whitespace-nowrap rounded-full border px-4 py-1.5 text-[13.5px] font-semibold", current === t.seg ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")} aria-current={current === t.seg ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
