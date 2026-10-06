import type { Metadata } from "next";
import { Card, StatusBadge, EmptyState, fmtDate, Banner } from "@/components/app/ui";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Progress" };

/** Per-learner progress. Phase 7 adds lesson-level progress, listening percentages, attempts, and filters. */
export default async function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { course, enrollments } = await loadBuilderCourse(id);
  const required = course.modules.filter((m) => m.status === "PUBLISHED").flatMap((m) => m.lessons).filter((l) => l.status === "PUBLISHED" && l.isRequired).length;
  return (
    <>
      <div className="mb-5"><Banner tone="info" title="Course progress is calculated from required lessons">{required} required lesson{required === 1 ? "" : "s"} are published. Lesson-level progress, listening percentages, and quiz attempts arrive with the quiz engine and progress tracking phases.</Banner></div>
      <Card title="Learners">
        {enrollments.length === 0 ? <EmptyState title="No learners yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead><tr className="border-b border-ink-100 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400"><th className="py-2 pr-3">Learner</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Enrolled</th><th className="px-2 py-2">Exam</th><th className="px-2 py-2">Completed</th></tr></thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-b border-ink-50">
                    <td className="py-2.5 pr-3 font-semibold text-ink-900">{e.agent.displayName}</td>
                    <td className="px-2 py-2.5"><StatusBadge status={e.status} /></td>
                    <td className="px-2 py-2.5 text-ink-600">{fmtDate(e.enrolledAt)}</td>
                    <td className="px-2 py-2.5 text-ink-600">{e.examScore !== null ? `${e.examScore}%` : "—"}</td>
                    <td className="px-2 py-2.5 text-ink-600">{e.completedAt ? fmtDate(e.completedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
