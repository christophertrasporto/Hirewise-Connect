import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getEnrollmentForAgent } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { Card } from "@/components/app/ui";
import { LessonContent } from "@/components/academy/LessonContent";
import { LESSON_TYPE_META, fmtDuration } from "@/components/academy/lesson-meta";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Lesson" };

/**
 * Lesson player for owners of the course: the lesson, a sidebar of every lesson in course order with progress, and
 * previous and next links. Progress is tracked by the same player used on the course page (90% watched completes a
 * video). Anyone who does not own the course is sent to the public course page, where the free previews are.
 */
export default async function LessonPlayerPage({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const actor = await requireActor();
  const { courseId, lessonId } = await params;
  let data: Awaited<ReturnType<typeof getEnrollmentForAgent>>;
  try {
    data = await getEnrollmentForAgent(prisma, actor, courseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { course, enrollment, lessonProgress, submissions, lockedLessons } = data;
  const owns = !!enrollment && !!course.modules && !("locked" in data && data.locked) && (enrollment.paymentStatus === "PAID" || enrollment.paymentStatus === "WAIVED" || enrollment.paymentStatus === "NOT_REQUIRED");
  if (!owns || !course.modules) redirect(`/academy/courses/${courseId}`);

  const flat = course.modules.flatMap((m) => m.lessons.map((l) => ({ lesson: l, module: m })));
  const index = flat.findIndex((x) => x.lesson.id === lessonId);
  if (index < 0) notFound();
  const { lesson, module } = flat[index];
  const prev = flat[index - 1]?.lesson ?? null;
  const next = flat[index + 1]?.lesson ?? null;
  const lessonHref = (id: string) => `/courses/${courseId}/lessons/${id}`;

  return (
    <>
      <Link href={`/courses/${courseId}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> {course.title}</Link>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="min-w-0 space-y-5">
          <Card title={lesson.title} description={`${module.title} · lesson ${index + 1} of ${flat.length}`}>
            <LessonContent modules={[{ ...module, lessons: [lesson] }]} courseId={courseId} progress={lessonProgress} submissions={submissions} locked={lockedLessons} />
          </Card>
          <nav className="flex items-center justify-between gap-3" aria-label="Lesson navigation">
            {prev ? (
              <Link href={lessonHref(prev.id)} className="inline-flex min-w-0 items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50"><ArrowLeft className="h-4 w-4 shrink-0" /> <span className="truncate">Previous: {prev.title}</span></Link>
            ) : <span />}
            {next ? (
              <Link href={lessonHref(next.id)} className="inline-flex min-w-0 items-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-brand-600"><span className="truncate">Next: {next.title}</span> <ArrowRight className="h-4 w-4 shrink-0" /></Link>
            ) : <span />}
          </nav>
        </div>

        <aside>
          <Card title="Lessons" description={`${flat.length} in this course`}>
            <ol className="space-y-4">
              {course.modules.map((m, mi) => (
                <li key={m.id}>
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {mi + 1} · {m.title}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {m.lessons.map((l) => {
                      const Icon = LESSON_TYPE_META[l.contentType].icon;
                      const done = lessonProgress[l.id]?.status === "COMPLETED";
                      const locked = !!lockedLessons[l.id];
                      const current = l.id === lessonId;
                      const row = (
                        <>
                          {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-label="Completed" /> : locked ? <Lock className="h-4 w-4 shrink-0 text-ink-300" aria-label="Locked" /> : <Icon className="h-4 w-4 shrink-0 text-ink-300" aria-hidden="true" />}
                          <span className="min-w-0 flex-1 truncate">{l.title}</span>
                          {l.durationSec ? <span className="text-[11.5px] text-ink-400">{fmtDuration(l.durationSec)}</span> : null}
                        </>
                      );
                      return (
                        <li key={l.id}>
                          {locked ? (
                            <span className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13.5px] text-ink-400" title={lockedLessons[l.id]}>{row}</span>
                          ) : (
                            <Link href={lessonHref(l.id)} aria-current={current ? "page" : undefined} className={cn("flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13.5px] hover:bg-ink-50", current ? "bg-ink-100 font-semibold text-ink-900" : "text-ink-700")}>{row}</Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
