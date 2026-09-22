import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listCoursesForCoach } from "@/server/services/academy.service";
import { studentsForCoach, listAssessmentsForCoach } from "@/server/services/assessment.service";
import { PageHeader, Card, StatTile, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Coach console" };

export default async function CoachPage() {
  const actor = await requireActor();
  const [courses, students, assessments] = await Promise.all([listCoursesForCoach(prisma, actor), studentsForCoach(prisma, actor), listAssessmentsForCoach(prisma, actor)]);
  const awaitingAssessment = students.filter((s) => s.completedAt && !assessments.some((a) => a.agentProfile.id === s.agentProfileId && a.course?.id === s.courseId));

  return (
    <>
      <PageHeader eyebrow="Coach console" title="Courses, exams, and students" description="Create courses with an exam and a price (free or USD). Admin publishes them; you assess students and recommend certifications." actions={<Link href="/coach/courses/new" className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[14.5px] font-semibold text-white hover:bg-ink-800"><Plus className="h-4 w-4" /> New course</Link>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatTile label="Courses" value={courses.length} hint={`${courses.filter((c) => c.status === "PUBLISHED").length} published`} />
        <StatTile label="Students" value={students.length} hint="Across your courses" />
        <StatTile label="Completed" value={students.filter((s) => s.completedAt).length} />
        <StatTile label="Awaiting assessment" value={awaitingAssessment.length} hint="Passed, not yet assessed" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card title="My courses">
          {courses.length === 0 ? <EmptyState title="No courses yet" description="Create your first course, add an exam, set the price, and submit it for publishing." action={<Link href="/coach/courses/new" className="inline-flex h-10 items-center rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white">Create a course</Link>} /> : (
            <ul className="divide-y divide-ink-100">
              {courses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/coach/courses/${c.id}`} className="block truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.title}</Link>
                    <p className="text-[12.5px] text-ink-400">{c.category} · {c.priceLabel} · {c.exam ? `${c.exam.questions.length} questions` : "no exam yet"} · {c.enrolledCount} enrolled</p>
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Students" description="Everyone enrolled in a course you coach.">
          {students.length === 0 ? <EmptyState title="No students yet" /> : (
            <ul className="divide-y divide-ink-100">
              {students.slice(0, 30).map((s) => (
                <li key={s.enrollmentId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium text-ink-800">{s.displayName} <span className="font-normal text-ink-400">· {s.courseTitle}</span></p>
                    <p className="text-[12.5px] text-ink-400">{s.examScore !== null ? `Exam ${s.examScore}%` : "No attempt yet"}{s.completedAt ? ` · completed ${fmtDate(s.completedAt)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.paymentStatus === "PENDING" && <StatusBadge status="PENDING" />}
                    <StatusBadge status={s.status} />
                    {s.completedAt && <Link href={`/coach/courses/${s.courseId}#assess-${s.agentProfileId}`} className="text-[12.5px] font-semibold text-brand-600">Assess</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent assessments" className="mt-5">
        {assessments.length === 0 ? <EmptyState title="No assessments yet" /> : (
          <ul className="divide-y divide-ink-100">
            {assessments.slice(0, 20).map((a) => <li key={a.id} className="flex items-center justify-between py-2.5 text-[14px]"><span className="text-ink-800">{a.agentProfile.displayName} <span className="text-ink-400">· {a.course?.title ?? "General"} · {fmtDate(a.assessedAt)}</span></span><span className="rounded-full bg-ink-900 px-2.5 py-0.5 text-[12px] font-semibold text-white">{a.resultLabel?.label ?? "—"}</span></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
