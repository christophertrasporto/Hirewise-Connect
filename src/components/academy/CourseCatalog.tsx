"use client";

import { useMemo, useState } from "react";
import { Lock, Search, Award } from "lucide-react";
import { cn } from "@/lib/cn";
import { CourseTile } from "./CourseTile";
import { Input } from "@/components/ui/Form";

export type CatalogCourse = {
  id: string;
  title: string;
  category: string;
  description: string;
  difficulty: string;
  coverUrl: string | null;
  priceCents: number;
  priceLabel: string;
  lessonCount: number;
  questionCount: number;
  certification: boolean;
  locked: boolean;
};

/** Talent catalog: search, category chips, and the cover grid. Filtering is client-side over the already-authorized list. */
export function CourseCatalog({ courses }: { courses: CatalogCourse[] }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const categories = useMemo(() => [...new Set(courses.map((c) => c.category))].sort(), [courses]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return courses.filter((c) => (!category || c.category === category) && (!needle || c.title.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle)));
  }, [courses, q, category]);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" className="h-10 pl-10 text-[14px]" />
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
            {["", ...categories].map((c) => (
              <button key={c || "all"} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 ring-inset transition", category === c ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50")}>
                {c || "All"}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-ink-200 p-8 text-center text-[14px] text-ink-500">No courses match your search.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <CourseTile
              key={c.id}
              href={c.locked ? "/onboarding/welcome-video" : `/courses/${c.id}`}
              cover={{ title: c.title, category: c.category, difficulty: c.difficulty, coverUrl: c.coverUrl }}
              pill={c.locked ? { label: "Locked", tone: "warn", icon: <Lock className="h-3.5 w-3.5" /> } : null}
              action={c.locked ? null : "View course"}
              title={c.title}
              description={c.description}
              dimmed={c.locked}
              footer={
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-3 py-1 text-[13px] font-bold", c.priceCents === 0 ? "bg-brand-50 text-brand-700" : "bg-ink-900 text-white")}>{c.priceLabel}</span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500">
                    {c.lessonCount > 0 ? `${c.lessonCount} lesson${c.lessonCount === 1 ? "" : "s"}` : `${c.questionCount} question exam`}
                    {c.certification && <Award className="h-3.5 w-3.5 text-gold-600" aria-label="Includes a certification" />}
                  </span>
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
