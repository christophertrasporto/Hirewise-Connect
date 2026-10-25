"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { CourseTile, type TilePill } from "./CourseTile";

export type BuilderCourse = {
  id: string;
  title: string;
  category: string;
  description: string;
  difficulty: string;
  coverUrl: string | null;
  status: string;
  priceLabel: string;
  moduleCount: number;
  lessonCount: number;
  enrolledCount: number;
  owner: string | null;
};

const PILLS: Record<string, TilePill> = {
  DRAFT: { label: "Draft", tone: "draft" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warn" },
  PUBLISHED: { label: "Published", tone: "good" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "PUBLISHED", label: "Published" },
  { key: "DRAFT", label: "Drafts" },
  { key: "PENDING_APPROVAL", label: "Awaiting approval" },
  { key: "ARCHIVED", label: "Archived" },
];

/** Coaches and Academy admins: every course they may build, as the same cover cards learners see, with status pills. */
export function BuilderCourseGrid({ courses }: { courses: BuilderCourse[] }) {
  const [status, setStatus] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of courses) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [courses]);
  const shown = status ? courses.filter((c) => c.status === status) : courses;
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.filter((f) => !f.key || counts.has(f.key)).map((f) => (
          <button key={f.key || "all"} type="button" onClick={() => setStatus(f.key)} aria-pressed={status === f.key} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 ring-inset transition", status === f.key ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50")}>
            {f.label} <span className={cn("tabular-nums", status === f.key ? "text-white/70" : "text-ink-400")}>{f.key ? counts.get(f.key) : courses.length}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => (
          <CourseTile
            key={c.id}
            href={`/courses/manage/${c.id}`}
            cover={{ title: c.title, category: c.category, difficulty: c.difficulty, coverUrl: c.coverUrl }}
            pill={PILLS[c.status] ?? { label: c.status, tone: "neutral" }}
            action="Open builder"
            title={c.title}
            description={c.description}
            footer={
              <div className="space-y-1">
                <p className="text-[12.5px] text-ink-500">{c.priceLabel} · {c.moduleCount} module{c.moduleCount === 1 ? "" : "s"} · {c.lessonCount} lesson{c.lessonCount === 1 ? "" : "s"} · {c.enrolledCount} enrolled</p>
                {c.owner && <p className="truncate text-[12px] text-ink-400">{c.owner}</p>}
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}
