import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, ExternalLink, Lock } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getEnrollmentForAgent } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { EnrolButton } from "@/components/academy/AgentCourseActions";
import { LessonContent, LessonOutline, embedUrl } from "@/components/academy/LessonContent";

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
  const { course, enrollment, lessonProgress, courseProgress, submissions, lockedLessons } = data;
  const onboardingLock = "locked" in data ? data.locked : null;
  const locked = enrollment?.paymentStatus === "PENDING";
  const completed = enrollment?.status === "COMPLETED";
  const intro = course.introVideoUrl ? embedUrl(course.introVideoUrl) : null;
  const requiredLessons = course.modules?.flatMap((m) => m.lessons).filter((l) => l.isRequired) ?? [];

  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader eyebrow={`${course.category} · ${course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}${course.estimatedMinutes ? ` · about ${Math.max(1, Math.round(course.estimatedMinutes / 60))} h` : ""}`} title={course.title} description={course.description} actions={<span className={course.priceCents === 0 ? "rounded-full bg-brand-50 px-4 py-1.5 text-[14px] font-bold text-brand-700" : "rounded-full bg-ink-900 px-4 py-1.5 text-[14px] font-bold text-white"}>{course.priceLabel}</span>} />

      {onboardingLock && <div className="mb-6"><Banner tone="warn" title="Locked until you finish onboarding">{onboardingLock.reason} <Link href={onboardingLock.href} className="font-semibold underline underline-offset-2">Watch the welcome video</Link>.</Banner></div>}
      {locked && <div className="mb-6"><Banner tone="warn" title={`Payment of ${enrollment!.priceLabel} pending`}>Send the course fee to Hirewise (bank transfer or GCash) and share the reference with your coach or account manager. The lessons unlock as soon as the payment is recorded.</Banner></div>}
      {completed && <div className="mb-6"><Banner tone="success" title={`Completed ${fmtDate(enrollment!.completedAt)}`}>{enrollment!.examScore !== null ? `Best quiz score ${enrollment!.examScore}%.` : ""}{course.certification ? ` Certification: ${course.certification.name}.` : ""}</Banner></div>}
      {enrollment && !locked && !completed && course.welcomeMessage && <div className="mb-6"><Banner tone="info" title="From your coach">{course.welcomeMessage}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          {!enrollment && intro && <Card title="Introduction"><div className="aspect-video overflow-hidden rounded-2xl bg-ink-900"><iframe src={intro} title="Course introduction" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div></Card>}
          <Card title="Lessons" description={course.lessonCount > 0 ? `${course.outline.length} module${course.outline.length === 1 ? "" : "s"} · ${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"} · ${requiredLessons.length || course.outline.flatMap((m) => m.lessons).length} required` : undefined}>
            {course.modules ? (
              course.modules.length === 0 ? <EmptyState title="The coach has not added lessons yet" description={course.syllabus ? "See the overview below." : undefined} /> : <LessonContent modules={course.modules} courseId={course.id} progress={lessonProgress} submissions={submissions} locked={lockedLessons} />
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
              {course.contentUrl && <a href={course.contentUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 hover:text-brand-700">Open external course materials <ExternalLink className="h-4 w-4" /></a>}
            </Card>
          )}
          {enrollment && enrollment.attempts.length > 0 && (
            <Card title="Past exam attempts" description="Attempts from before the course moved to lesson quizzes.">
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
                {onboardingLock ? <Link href={onboardingLock.href} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[14.5px] font-semibold text-white hover:bg-ink-800"><Lock className="h-4 w-4" /> Finish onboarding to enrol</Link> : <EnrolButton courseId={course.id} priceLabel={course.priceLabel} />}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2"><StatusBadge status={enrollment.status} />{enrollment.priceCents > 0 && <StatusBadge status={enrollment.paymentStatus} />}</div>
                {courseProgress && (
                  <div>
                    <div className="flex items-end justify-between"><p className="font-display text-[2rem] font-extrabold leading-none text-ink-900">{courseProgress.percent}%</p><p className="text-[12.5px] text-ink-400">{courseProgress.requiredDone} of {courseProgress.requiredTotal} required lessons</p></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${courseProgress.percent}%` }} /></div>
                  </div>
                )}
                <dl className="space-y-2 text-[13.5px]">
                  <div className="flex justify-between"><dt className="text-ink-500">Enrolled</dt><dd className="font-medium text-ink-800">{fmtDate(enrollment.enrolledAt)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Default passing score</dt><dd className="font-medium text-ink-800">{course.passingScore}%</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Quizzes</dt><dd className="font-medium text-ink-800">{course.quizCount}</dd></div>
                  {course.sequentialUnlock && <div className="flex justify-between"><dt className="text-ink-500">Order</dt><dd className="font-medium text-ink-800">Lessons unlock in sequence</dd></div>}
                </dl>
                {!completed && !locked && course.quizCount === 0 && <p className="text-[13px] text-ink-500">This course has no quiz yet.</p>}
              </div>
            )}
          </Card>
          {course.certification && (
            <Card title="Certification">
              <p className="inline-flex items-center gap-1.5 text-[14px] font-bold text-gold-800"><Award className="h-4 w-4" /> {course.certification.name}</p>
              <p className="mt-1 text-[13px] text-ink-500">Issued after you complete the course{" "}and any required coach review. Certifications are visible to clients on your profile.</p>
            </Card>
          )}
          <Card title="Coach"><p className="text-[14px] text-ink-700">{course.coach}</p></Card>
        </div>
      </div>
    </>
  );
}
