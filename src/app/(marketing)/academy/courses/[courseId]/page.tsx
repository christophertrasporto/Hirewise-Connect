import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Award, Clock, Lock, PlayCircle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { NotFoundError } from "@/server/policies/authorize";
import { getPublicCourse } from "@/server/services/course-public.service";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { startReturnHref } from "@/lib/return-to";
import { LessonContent } from "@/components/academy/LessonContent";
import { LESSON_TYPE_META, fmtDuration } from "@/components/academy/lesson-meta";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const { courseId } = await params;
  try {
    const c = await getPublicCourse(prisma, null, courseId);
    return { title: c.title, description: c.description.slice(0, 160) };
  } catch {
    return { title: "Course" };
  }
}

/**
 * Public course page. Anyone can watch the free-preview lessons here, signed in or not; every other lesson shows a lock
 * and leads to buying. The player points at our lesson route, never at a stored video address, and ?ref=CODE is passed to
 * the referral capture route so affiliate links can point straight at a course.
 */
export default async function PublicCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const auth = await getCurrentAuth();
  let course: Awaited<ReturnType<typeof getPublicCourse>>;
  try {
    course = await getPublicCourse(prisma, auth?.actor ?? null, courseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const appHref = `/courses/${course.id}`;
  // Signed out: these links remember the course, then go to sign-up or login, and the dashboard brings them back.
  // Plain anchors (not Link) so nothing prefetches the cookie-setting route.
  const signUpHref = startReturnHref(course.id, "register");
  const logInHref = startReturnHref(course.id, "login");
  const cta = {
    SIGNED_OUT: { label: course.priceCents === 0 ? "Enrol for free" : "Buy course", href: signUpHref, note: "Create a free talent account and you will come straight back here to buy this course. Already have an account?" },
    CAN_BUY: { label: course.priceCents === 0 ? "Enrol for free" : "Buy course", href: appHref, note: null },
    PENDING: { label: "Complete your payment", href: appHref, note: "You are enrolled; the lessons unlock when your payment is confirmed." },
    OWNER: { label: "Continue learning", href: appHref, note: "You own this course." },
    ENDED: { label: "View course", href: appHref, note: "Your access to this course has ended." },
    NOT_TALENT: { label: "", href: "", note: "Courses are for talent accounts." },
  }[course.state];

  return (
    <>
      <ReferralCapture />
      <section className="relative overflow-hidden border-b border-ink-100 bg-hero">
        <div className="container-x relative grid gap-10 py-12 lg:grid-cols-[1.25fr_0.75fr] lg:py-16">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-500">
              <Badge>{course.category}</Badge>
              <span>{course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}</span>
              {course.estimatedMinutes ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> about {Math.max(1, Math.round(course.estimatedMinutes / 60))} h</span> : null}
            </div>
            <h1 className="mt-4 text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-[2.8rem]">{course.title}</h1>
            <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-ink-500">{course.description}</p>

            <div className="mt-8">
              {course.previewModules.length > 0 ? (
                <>
                  <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-brand-700"><PlayCircle className="h-4 w-4" /> Free preview, no account needed</p>
                  <LessonContent modules={course.previewModules} />
                </>
              ) : (
                <div className="rounded-3xl border border-ink-100 bg-white p-6 text-[14.5px] text-ink-500 shadow-soft">This course has no free preview yet.</div>
              )}
            </div>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-lift">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Price</p>
              <p className="mt-1 font-display text-[2rem] font-extrabold text-ink-900">{course.priceLabel}</p>
              {cta.label && (
                <Button href={cta.href} prefetch={false} size="lg" className="mt-4 w-full justify-center">
                  {cta.label} <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              {cta.note && (
                <p className="mt-3 text-[13px] leading-relaxed text-ink-500">
                  {cta.note}
                  {course.state === "SIGNED_OUT" && <> <a href={logInHref} className="font-semibold text-brand-700 hover:text-brand-800">Log in</a>.</>}
                </p>
              )}
              <ul className="mt-5 space-y-2 border-t border-ink-100 pt-5 text-[13.5px] text-ink-600">
                <li>{course.lessonCount} lesson{course.lessonCount === 1 ? "" : "s"}{course.previewCount ? `, ${course.previewCount} free to watch` : ""}</li>
                {course.certification && <li className="flex items-start gap-2"><Award className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" /> {course.certification}, added to your profile when you pass</li>}
                <li>Pay online with Maya, or by bank transfer or GCash</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <section className="py-14 lg:py-20">
        <div className="container-x max-w-3xl">
          <h2 className="text-[1.6rem] font-bold">What is in this course</h2>
          <ol className="mt-6 space-y-6">
            {course.curriculum.map((m, i) => (
              <li key={m.id}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {i + 1}</p>
                <p className="text-[16px] font-bold text-ink-900">{m.title}</p>
                <ul className="mt-2 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
                  {m.lessons.map((l) => {
                    const Icon = LESSON_TYPE_META[l.contentType].icon;
                    return (
                      <li key={l.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                        <Icon className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-ink-800">{l.title}</span>
                        {l.durationSec ? <span className="text-[12.5px] text-ink-400">{fmtDuration(l.durationSec)}</span> : null}
                        {l.isFreePreview ? (
                          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">Free preview</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[12px] text-ink-400" title="Included when you buy the course"><Lock className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Locked: </span>Locked</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          {cta.label && (
            <div className="mt-10">
              <Button href={cta.href} prefetch={false} size="lg">{cta.label} <ArrowRight className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
