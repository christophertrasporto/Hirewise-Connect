import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { attemptForLearner } from "@/server/services/quiz.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Banner, fmtDate } from "@/components/app/ui";
import { AttemptReview, QuizRunner } from "@/components/academy/QuizRunner";

export const metadata: Metadata = { title: "Quiz attempt" };

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const actor = await requireActor();
  const { attemptId } = await params;
  let a: Awaited<ReturnType<typeof attemptForLearner>>;
  try {
    a = await attemptForLearner(prisma, actor, attemptId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const open = a.status === "IN_PROGRESS";
  return (
    <>
      <Link href={`/courses/${a.courseId}/quiz/${a.lessonId}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> {a.lessonTitle}</Link>
      <PageHeader eyebrow={a.courseTitle} title={a.lessonTitle} description={open ? `Answer every question. You need ${a.passingScore}% to pass.` : `Submitted ${fmtDate(a.submittedAt)}`} />
      {open ? (
        <QuizRunner attemptId={a.id} questions={a.questions.map((q) => ({ questionId: q.questionId, type: q.type, prompt: q.prompt, points: q.points, choices: q.choices }))} expiresAt={a.expiresAt ? a.expiresAt.toISOString() : null} courseId={a.courseId} lessonId={a.lessonId} passingScore={a.passingScore} />
      ) : (
        <>
          <div className="mb-6">
            <Banner tone={a.result?.passed ? "success" : a.result?.pendingReview ? "warn" : "info"} title={a.result?.pendingReview ? `Awaiting coach review · ${a.result.scorePercent ?? "—"}% so far` : a.status === "EXPIRED" ? "Timed out" : `${a.result?.scorePercent ?? "—"}% · ${a.result?.passed ? "Passed" : "Not passed"}`}>
              {a.result?.feedback ? `Coach feedback: ${a.result.feedback}` : a.result?.pendingReview ? "Written answers are scored by your coach. You will be notified." : a.result?.passed ? "This attempt passed." : `You need ${a.passingScore}% to pass.`}
            </Banner>
          </div>
          <AttemptReview questions={a.questions.map((q) => ({ questionId: q.questionId, type: q.type, prompt: q.prompt, points: q.points, choices: q.choices, answer: q.answer ?? null, correctChoiceIds: q.correctChoiceIds, explanation: q.explanation, correct: q.correct }))} />
        </>
      )}
    </>
  );
}
