import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, ExternalLink, Lock } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getEnrollmentForAgent } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { EnrolButton, StartExamButton } from "@/components/academy/AgentCourseActions";
import { LessonContent, LessonOutline } from "@/components/academy/LessonContent";

export const metadata: Metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const actor = await requireActor();
  const { courseId } = await params;
  let data: Awaited<ReturnType<typeof getEnrollmentForAgent>>;
  try {
    data = await getEnrollmentForAgent(prisma, actor, courseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { course, enrollment, exam } = data;
  const locked = enrollment?.paymentStatus === "PENDING";
  const completed = enrollment?.status === "COMPLETED";

  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Academy</Link>
      <PageHeader eyebrow={course.category} title={course.title} description={course.description} actions={<span className={course.priceCents === 0 ? "rounded-full bg-brand-50 px-4 py-1.5 text-[14px] font-bold text-brand-700" : "rounded-full bg-ink-900 px-4 py-1.5 text-[14px] font-bold text-white"}>{course.priceLabel}</span>} />

      {locked && <div className="mb-6"><Banner tone="warn" title={`Payment of ${enrollment!.priceLabel} pending`}>Send the course fee to Hirewise (bank transfer or GCash) and share the reference with your coach or account manager. The syllabus and exam unlock as soon as the payment is recorded.</Banner></div>}
      {completed && <div className="mb-6"><Banner tone="success" title={`Completed ${fmtDate(enrollment!.completedAt)}`}>Exam score {enrollment!.examScore}%.{course.certification ? ` Certification: ${course.certification.name}.` : ""}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <Card title="Lessons" description={course.lessonCount > 0 ? `${course.outline.length} module${course.outline.length === 1 ? "" : "s"} · ${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}` : undefined}>
            {course.modules ? (
              course.modules.length === 0 ? <EmptyState title="The coach has not added lessons yet" description={course.syllabus ? "See the overview below." : undefined} /> : <LessonContent modules={course.modules} />
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3 rounded-2xl bg-ink-50 p-5 text-[14px] text-ink-500"><Lock className="h-5 w-5 text-ink-300" /> {enrollment ? "Lessons unlock as soon as your payment is recorded." : "Enrol to open the lessons."}</div>
                {course.outline.length > 0 && <LessonOutline modules={course.outline} />}
              </>
            )}
          </Card>
          {(course.syllabus || course.contentUrl) && (
            <Card title="Overview">
              {course.syllabus && <div className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">{course.syllabus}</div>}
              {course.contentUrl && <a href={course.contentUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 hover:text-brand-700">Open external course materials <ExternalLink className="h-4 w-4" /></a>}
            </Card>
          )}
          {enrollment && enrollment.attempts.length > 0 && (
            <Card title="Exam attempts">
              <ul className="divide-y divide-ink-100 text-[14px]">
                {enrollment.attempts.map((a) => <li key={a.id} className="flex items-center justify-between py-2.5"><span className="text-ink-600">{fmtDate(a.submittedAt)}</span><span className={a.passed ? "font-semibold text-brand-700" : "font-semibold text-ink-700"}>{a.scorePercent ?? "—"}% · {a.passed ? "Passed" : "Not passed"}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title={enrollment ? "Your progress" : "Enrol"}>
            {!enrollment ? (
              <div className="space-y-3">
                <p className="text-[13.5px] text-ink-600">{course.priceCents === 0 ? "This course is free." : `This course costs ${course.priceLabel}. Enrol now and pay Hirewise offline; the content unlocks once the payment is recorded.`}</p>
                <EnrolButton courseId={course.id} priceLabel={course.priceLabel} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2"><StatusBadge status={enrollment.status} />{enrollment.priceCents > 0 && <StatusBadge status={enrollment.paymentStatus} />}</div>
                <dl className="space-y-2 text-[13.5px]">
                  <div className="flex justify-between"><dt className="text-ink-500">Enrolled</dt><dd className="font-medium text-ink-800">{fmtDate(enrollment.enrolledAt)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Passing score</dt><dd className="font-medium text-ink-800">{course.passingScore}%</dd></div>
                  {exam && <div className="flex justify-between"><dt className="text-ink-500">Attempts used</dt><dd className="font-medium text-ink-800">{exam.attemptsUsed} / {exam.maxAttempts}</dd></div>}
                </dl>
                {!completed && exam && exam.attemptsUsed < exam.maxAttempts && <StartExamButton courseId={course.id} label={exam.openAttemptId ? "Resume exam" : exam.attemptsUsed > 0 ? "Retake exam" : "Start exam"} />}
                {!completed && exam && exam.attemptsUsed >= exam.maxAttempts && <p className="text-[13px] text-red-600">You have used all attempts. Ask your coach about a retake.</p>}
                {!completed && !exam && !locked && <p className="text-[13px] text-ink-500">The exam is not published yet.</p>}
              </div>
            )}
          </Card>
          {exam && (
            <Card title="About the exam">
              <p className="text-[14px] font-semibold text-ink-800">{exam.title}</p>
              <p className="mt-1 text-[13px] text-ink-500">{exam.questionCount} questions{exam.timeLimitMin ? ` · ${exam.timeLimitMin} minutes` : " · untimed"} · {exam.maxAttempts} attempt{exam.maxAttempts === 1 ? "" : "s"}</p>
              {exam.instructions && <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-line text-ink-600">{exam.instructions}</p>}
            </Card>
          )}
          {course.certification && (
            <Card title="Certification">
              <p className="inline-flex items-center gap-1.5 text-[14px] font-bold text-gold-800"><Award className="h-4 w-4" /> {course.certification.name}</p>
              <p className="mt-1 text-[13px] text-ink-500">Issued after you pass the exam{" "}and any required coach review. Certifications are visible to clients on your profile.</p>
            </Card>
          )}
          <Card title="Coach"><p className="text-[14px] text-ink-700">{course.coach}</p></Card>
        </div>
      </div>
    </>
  );
}
