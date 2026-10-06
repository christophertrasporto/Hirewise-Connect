import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { listLabels } from "@/server/services/assessment.service";
import { Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { AssessmentForm } from "@/components/academy/CourseActions";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Learners" };

export default async function LearnersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { course, enrollments } = await loadBuilderCourse(id);
  const labels = await listLabels(prisma);
  const assessed = new Set((await prisma.assessment.findMany({ where: { courseId: course.id, status: "FINAL" }, select: { agentProfileId: true } })).map((a) => a.agentProfileId));

  return (
    <Card title="Learners" description="Everyone enrolled in this course. Assess learners who completed it; coach review feeds certification.">
      {enrollments.length === 0 ? <EmptyState title="No learners yet" description={course.status === "PUBLISHED" ? "Talent can enrol from the catalog." : "Learners can enrol once the course is published."} /> : (
        <ul className="divide-y divide-ink-100">
          {enrollments.map((e) => (
            <li key={e.id} id={`assess-${e.agent.id}`} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold text-ink-900">{e.agent.displayName} <span className="font-normal text-ink-400">· {e.agent.primaryRole ?? "Talent"}</span></p>
                  <p className="text-[12.5px] text-ink-400">Enrolled {fmtDate(e.enrolledAt)}{e.examScore !== null ? ` · exam ${e.examScore}%` : ""}{e.completedAt ? ` · completed ${fmtDate(e.completedAt)}` : ""}</p>
                </div>
                <div className="flex gap-2"><StatusBadge status={e.status} />{course.priceCents > 0 && <StatusBadge status={e.paymentStatus} />}</div>
              </div>
              {e.completedAt && !assessed.has(e.agent.id) && (
                <details className="mt-3 rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
                  <summary className="cursor-pointer text-[13.5px] font-semibold text-brand-700">Record assessment</summary>
                  <div className="mt-4"><AssessmentForm courseId={course.id} agentProfileId={e.agent.id} displayName={e.agent.displayName} labels={labels.map((l) => ({ id: l.id, label: l.label, rank: l.rank }))} examScore={e.examScore} /></div>
                </details>
              )}
              {assessed.has(e.agent.id) && <p className="mt-2 text-[12.5px] font-semibold text-brand-700">Assessed</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
