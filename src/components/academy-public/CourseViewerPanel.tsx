"use client";

import { ArrowRight, Award } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { courseCta } from "@/lib/course-cta";
import { useCourseViewer } from "./use-course-viewer";
import { ShareButton } from "./ShareButton";

type PanelCourse = { id: string; slug: string; title: string; priceCents: number; priceLabel: string; lessonCount: number; previewCount: number; certification: string | null };

/**
 * The price card with the Buy button, beside the course on large screens and as a bar along the bottom on phones. The
 * cached page renders the signed-out version for everyone; once the visitor is known, the button and note change to fit
 * (Buy, Complete your payment, Continue learning) and the Share button learns whether to attach their referral code.
 */
export function CourseViewerPanel({ course, payNote }: { course: PanelCourse; /** How this course can be paid, built on the server from the gateways that are switched on. */ payNote: string }) {
  const viewer = useCourseViewer(course.id);
  const cta = courseCta(viewer?.state ?? "SIGNED_OUT", course);
  const path = `/academy/${course.slug}`;

  return (
    <>
      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Buy this course">
        <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-lift">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Price</p>
          <p className="mt-1 font-display text-[2rem] font-extrabold text-ink-900">{course.priceLabel}</p>
          {cta.label && (
            <Button href={cta.href} prefetch={false} size="lg" className="mt-4 w-full justify-center">
              {cta.label} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {cta.note && (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-500" aria-live="polite">
              {cta.note}
              {cta.logIn && (
                <>
                  {" "}
                  <a href={cta.logIn} className="font-semibold text-brand-700 hover:text-brand-800">
                    Log in
                  </a>
                  .
                </>
              )}
            </p>
          )}
          <ul className="mt-5 space-y-2 border-t border-ink-100 pt-5 text-[13.5px] text-ink-600">
            <li>
              {course.lessonCount} lesson{course.lessonCount === 1 ? "" : "s"}
              {course.previewCount ? `, ${course.previewCount} free to watch` : ""}
            </li>
            {course.certification && (
              <li className="flex items-start gap-2">
                <Award className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" aria-hidden="true" /> {course.certification}, added to your profile when you pass
              </li>
            )}
            <li>{payNote}</li>
          </ul>
          <ShareButton path={path} title={course.title} personal={!!viewer?.canShare} className="mt-5 border-t border-ink-100 pt-5" />
        </div>
      </aside>

      {cta.label && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(10_22_40/0.25)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-4">
            <p className="font-display text-[1.25rem] font-extrabold text-ink-900">{course.priceLabel}</p>
            <Button href={cta.href} prefetch={false} className="flex-1 justify-center">
              {cta.label} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
