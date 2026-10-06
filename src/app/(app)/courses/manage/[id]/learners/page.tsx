import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { listLabels } from "@/server/services/assessment.service";
import { Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { AssessmentForm } from "@/components/academy/CourseActions";
import { ReviewAttemptForm } from "@/components/academy/QuizRunner";
import { ReviewSubmissionForm } from "@/components/academy/LessonActions";
import { attemptsAwaitingReview } from "@/server/services/quiz.service";
import { submissionsAwaitingReview } from "@/server/services/assignment.service";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Learners" };

export default async function LearnersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, course, enrollments } = await loadBuilderCourse(id);
  const labels = await listLabels(prisma);
  const reviews = actor.permissions.has("course.manage") || actor.permissions.has("course.quiz.build") ? await attemptsAwaitingReview(prisma, actor, course.id).catch(() => []) : [];
  const submissions = actor.permissions.has("course.manage") || actor.permissions.has("assignment.review") ? await submissionsAwaitingReview(prisma, actor, course.id).catch(() => []) : [];
  const assessed = new Set((await prisma.assessment.findMany({ where: { courseId: course.id, status: "FINAL" }, select: { agentProfileId: true } })).map((a) => a.agentProfileId));

  return (
    <div className="space-y-5">
    {reviews.length > 0 && (
      <Card title={`Attempts awaiting your review (${reviews.length})`} description="Written answers without keyword matching, or assessments set to manual review. Record the final score; the learner is notified and course progress updates.">
        <ul className="divide-y divide-ink-100">
          {reviews.map((r) => (
            <li key={r.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14.5px] font-semibold text-ink-900">{r.learner.displayName} <span className="font-normal text-ink-400">· {r.lesson.title} · submitted {fmtDate(r.submittedAt)}</span></p>
                <span className="text-[12.5px] text-ink-500">Auto score so far: {r.autoScore ?? 0}%</span>
              </div>
              {(r.reviewMode === "AUTO" ? r.answers.filter((a) => a.correct === null) : r.answers).map((a) => (
                <div key={a.questionId} className={`rounded-2xl p-3 text-[13.5px] ${a.correct === true ? "bg-brand-50/60" : a.correct === false ? "bg-red-50/60" : "bg-ink-50"}`}>
                  <p className="font-semibold text-ink-800">{a.prompt} <span className="font-normal text-ink-400">· {a.points} pt{a.points === 1 ? "" : "s"}{a.correct === true ? " · correct" : a.correct === false ? " · incorrect" : " · needs your mark"}</span></p>
                  <p className="mt-1 whitespace-pre-line text-ink-700">{a.answer || <span className="text-ink-400">No answer</span>}</p>
                  {a.correct !== true && a.correctAnswer && <p className="mt-1 text-[12.5px] text-ink-500">{a.type === "SHORT_ANSWER" ? "Keywords" : "Correct"}: {a.correctAnswer}</p>}
                </div>
              ))}
              <ReviewAttemptForm courseId={course.id} attemptId={r.id} autoScore={r.autoScore} passingScore={r.passingScore} />
            </li>
          ))}
        </ul>
      </Card>
    )}
    {submissions.length > 0 && (
      <Card title={`Assignments awaiting your review (${submissions.length})`} description="Grade, add feedback, and mark the lesson complete, or return the work for another try.">
        <ul className="divide-y divide-ink-100">
          {submissions.map((s) => (
            <li key={s.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14.5px] font-semibold text-ink-900">{s.learner.displayName} <span className="font-normal text-ink-400">· {s.lesson.title} · submitted {fmtDate(s.submittedAt)}{s.late ? " · late" : ""}</span></p>
                {s.lesson.points ? <span className="text-[12.5px] text-ink-500">Out of {s.lesson.points} points</span> : null}
              </div>
              <div className="space-y-1 rounded-2xl bg-ink-50 p-3 text-[13.5px] text-ink-700">
                {s.text && <p className="whitespace-pre-line">{s.text}</p>}
                {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-brand-600">{s.url}</a>}
                {s.hasFile && <a href={`/api/academy/submissions/${s.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600">{s.fileName ?? "Download file"}</a>}
              </div>
              <ReviewSubmissionForm courseId={course.id} submissionId={s.id} maxPoints={s.lesson.points} />
            </li>
          ))}
        </ul>
      </Card>
    )}
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
    </div>
  );
}
