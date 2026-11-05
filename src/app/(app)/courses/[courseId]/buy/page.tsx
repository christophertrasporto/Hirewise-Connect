import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Award, PlayCircle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getEnrollmentForAgent } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { mayaAvailableFor, reconcileMyCourse } from "@/server/services/maya-payment.service";
import { paypalAvailableFor, reconcileMyPayPalPayment } from "@/server/services/paypal-payment.service";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { CourseCover } from "@/components/academy/CourseTile";
import { PurchaseForm } from "@/components/academy/PurchaseForm";
import { PendingPromoBox } from "@/components/academy/PromoCode";

export const metadata: Metadata = { title: "Checkout" };

/**
 * The checkout screen a Buy course button leads to. It enrols nothing on its own: the learner presses one button, which
 * enrols (with a promo code, if entered) and goes straight to the payment they chose. Someone who already owns the course
 * is sent to it; someone enrolled but unpaid sees their price and the same payment buttons.
 */
export default async function BuyCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const actor = await requireActor();
  const { courseId } = await params;
  if (actor.role !== "AGENT") {
    return (
      <>
        <PageHeader eyebrow="Checkout" title="Courses are for talent accounts" description="Sign in with a talent account to buy a course." />
        <Link href="/academy" className="text-[14px] font-semibold text-brand-700 hover:text-brand-800">Back to the Academy</Link>
      </>
    );
  }
  // Back from a gateway to this screen (or reopening it): confirm any open online payment so an owner is sent on at once.
  await Promise.all([reconcileMyCourse(prisma, actor, courseId), reconcileMyPayPalPayment(prisma, actor, courseId)]);

  let data: Awaited<ReturnType<typeof getEnrollmentForAgent>>;
  try {
    data = await getEnrollmentForAgent(prisma, actor, courseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { course, enrollment } = data;
  if (enrollment && enrollment.paymentStatus !== "PENDING") redirect(`/courses/${courseId}`);

  const onboardingLock = "locked" in data && data.locked?.kind === "ONBOARDING" ? data.locked : null;
  const pricing = enrollment ? { currency: enrollment.currency, priceCents: enrollment.priceCents, priceLabel: enrollment.priceLabel } : { currency: course.currency, priceCents: course.priceCents, priceLabel: course.priceLabel };
  const methods = { maya: mayaAvailableFor(pricing), paypal: paypalAvailableFor(pricing) };

  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Courses
      </Link>
      <PageHeader eyebrow="Checkout" title={course.title} description={enrollment ? "You are enrolled. Choose how to pay and the lessons unlock automatically." : "One step: choose how to pay and you are enrolled."} />

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          {onboardingLock && (
            <Banner tone="warn" title="Watch the welcome video first">
              {onboardingLock.reason}{" "}
              <Link href={onboardingLock.href} className="font-semibold underline underline-offset-2">
                Watch the welcome video
              </Link>
              , then come back to check out from the course page.
            </Banner>
          )}
          <Card title="Your order">
            <div className="max-w-md overflow-hidden rounded-card border border-ink-100">
              <CourseCover title={course.title} category={course.category} difficulty={course.difficulty} coverUrl={course.coverUrl} eager />
            </div>
            <dl className="mt-4 space-y-2 text-[14px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Course</dt>
                <dd className="text-right font-medium text-ink-900">{course.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Lessons</dt>
                <dd className="font-medium text-ink-900">{course.lessonCount}</dd>
              </div>
              {course.certification && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">Certification</dt>
                  <dd className="inline-flex items-center gap-1.5 text-right font-medium text-ink-900">
                    <Award className="h-4 w-4 text-gold-600" aria-hidden="true" /> {course.certification.name}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-ink-100 pt-2">
                <dt className="font-semibold text-ink-900">Total</dt>
                <dd className="font-display text-[1.2rem] font-extrabold text-ink-900">
                  {pricing.priceLabel}
                  {enrollment?.listPriceLabel && <span className="ml-2 text-[13px] font-normal text-ink-400 line-through">{enrollment.listPriceLabel}</span>}
                </dd>
              </div>
            </dl>
            <Link href={`/academy/courses/${courseId}`} className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">
              <PlayCircle className="h-4 w-4" aria-hidden="true" /> Watch the free preview again
            </Link>
          </Card>
        </div>

        <Card title="Payment">
          {onboardingLock ? (
            <p className="text-[14px] text-ink-600">Checkout opens as soon as you have watched the welcome video.</p>
          ) : (
            <>
              <PurchaseForm courseId={courseId} priceLabel={pricing.priceLabel} free={pricing.priceCents === 0} methods={methods} allowPromo={!enrollment} />
              {enrollment && <PendingPromoBox enrollmentId={enrollment.id} promo={enrollment.promo} />}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
