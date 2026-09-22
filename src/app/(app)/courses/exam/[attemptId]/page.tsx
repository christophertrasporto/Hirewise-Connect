import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getAttemptForAgent, getEnrollmentForAgent } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Banner } from "@/components/app/ui";
import { ExamRunner } from "@/components/academy/AgentCourseActions";

export const metadata: Metadata = { title: "Exam" };

export default async function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const actor = await requireActor();
  const { attemptId } = await params;
  let a: Awaited<ReturnType<typeof getAttemptForAgent>>;
  try {
    a = await getAttemptForAgent(prisma, actor, attemptId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { course } = await getEnrollmentForAgent(prisma, actor, a.courseId);

  return (
    <>
      <Link href={`/courses/${a.courseId}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> {a.courseTitle}</Link>
      <PageHeader eyebrow="Exam" title={a.examTitle} description={a.instructions ?? `Answer every question. You need ${course.passingScore}% to pass.`} />
      {a.status !== "IN_PROGRESS" ? (
        <Banner tone={a.result?.passed ? "success" : "info"} title={`Submitted · ${a.result?.scorePercent ?? "—"}%`}>{a.result?.passed ? "You passed this attempt." : "This attempt did not pass."} <Link href={`/courses/${a.courseId}`} className="font-semibold underline">Back to course</Link></Banner>
      ) : (
        <ExamRunner attemptId={a.id} questions={a.questions} expiresAt={a.expiresAt ? a.expiresAt.toISOString() : null} courseId={a.courseId} passingScore={course.passingScore} />
      )}
    </>
  );
}
