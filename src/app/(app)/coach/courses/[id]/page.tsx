import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getCourseForCoach, listTemplatesForAdmin } from "@/server/services/academy.service";
import { listLabels } from "@/server/services/assessment.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { CourseForm } from "@/components/academy/CourseForm";
import { ExamBuilder } from "@/components/academy/ExamBuilder";
import { CourseWorkflowButton, AssessmentForm } from "@/components/academy/CourseActions";

export const metadata: Metadata = { title: "Course" };

export default async function CoachCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getCourseForCoach>>;
  try {
    data = await getCourseForCoach(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { course, enrollments } = data;
  const isAdmin = actor.permissions.has("course.manage");
  const [labels, templates] = await Promise.all([listLabels(prisma), isAdmin ? listTemplatesForAdmin(prisma, actor) : Promise.resolve([])]);
  const examLocked = course.exam?.status === "PUBLISHED" && course.status === "PUBLISHED";
  const assessed = new Set((await prisma.assessment.findMany({ where: { courseId: course.id, status: "FINAL" }, select: { agentProfileId: true } })).map((a) => a.agentProfileId));

  return (
    <>
      <Link href="/coach" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Coach console</Link>
      <PageHeader eyebrow={course.category} title={course.title} description={`${course.priceLabel} · passing score ${course.passingScore}% · ${course.enrolledCount} enrolled${course.publishedAt ? ` · published ${fmtDate(course.publishedAt)}` : ""}`} actions={<><StatusBadge status={course.status} />{course.certificationTemplate && <span className="rounded-full bg-gold-50 px-2.5 py-1 text-[11.5px] font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">{course.certificationTemplate.name}</span>}</>} />

      {course.status === "DRAFT" && <div className="mb-6"><Banner tone="info" title="Draft">Finish the exam below, then submit the course for publishing. Admin links a certification template and publishes it to the catalog.</Banner></div>}
      {course.status === "PENDING_APPROVAL" && <div className="mb-6"><Banner tone="warn" title="Waiting for Admin">Admin has been notified. You can still edit the description and syllabus.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card title="Course details"><CourseForm course={{ id: course.id, title: course.title, category: course.category, description: course.description, syllabus: course.syllabus, contentUrl: course.contentUrl, priceCents: course.priceCents, passingScore: course.passingScore, requiresCoachReview: course.requiresCoachReview }} /></Card>
          <Card title="Exam" description="Single-answer multiple choice. Talent never sees which option is correct.">
            <ExamBuilder courseId={course.id} exam={course.exam ? { title: course.exam.title, instructions: course.exam.instructions, timeLimitMin: course.exam.timeLimitMin, maxAttempts: course.exam.maxAttempts, status: course.exam.status, questions: course.exam.questions.map((q) => ({ prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation ?? "" })) } : null} locked={examLocked} />
          </Card>
          <Card title="Students" description="Enrolments in this course. Assess students who completed the exam.">
            {enrollments.length === 0 ? <EmptyState title="No students yet" /> : (
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
        </div>
        <div className="space-y-5">
          <Card title="Publishing">
            <div className="space-y-3">
              {course.status === "DRAFT" && <CourseWorkflowButton courseId={course.id} op="SUBMIT" label="Submit for publishing" variant="primary" />}
              {isAdmin && (course.status === "PENDING_APPROVAL" || course.status === "DRAFT") && <CourseWorkflowButton courseId={course.id} op="PUBLISH" label="Publish to catalog" variant="dark" templates={templates.map((t) => ({ id: t.id, name: t.name }))} />}
              {isAdmin && course.status === "PUBLISHED" && <CourseWorkflowButton courseId={course.id} op="ARCHIVE" label="Archive course" variant="outline" confirm="Archive this course? Enrolled students keep their progress but new enrolments stop." />}
              {course.status === "PUBLISHED" && !isAdmin && <p className="text-[13.5px] text-ink-500">Live in the catalog. Contact Admin to archive.</p>}
              {course.status === "ARCHIVED" && <p className="text-[13.5px] text-ink-500">Archived.</p>}
            </div>
          </Card>
          <Card title="Coaches">
            <ul className="space-y-1 text-[14px] text-ink-700">
              <li>{course.ownerCoach.email} <span className="text-ink-400">· owner</span></li>
              {course.coaches.filter((c) => c.id !== course.ownerCoach.id).map((c) => <li key={c.id}>{c.email}</li>)}
            </ul>
          </Card>
          <Card title="Pricing">
            <p className="font-display text-[2rem] font-extrabold text-ink-900">{course.priceLabel}</p>
            <p className="mt-1 text-[13px] text-ink-500">{course.priceCents === 0 ? "Free courses unlock immediately on enrolment." : "Paid courses unlock once Hirewise records the student's payment. Talent pays Hirewise directly; no card processing in this phase."}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
