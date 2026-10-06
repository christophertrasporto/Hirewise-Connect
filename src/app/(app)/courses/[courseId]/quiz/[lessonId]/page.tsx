import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { quizStateForLearner } from "@/server/services/quiz.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { StartQuizButton } from "@/components/academy/QuizRunner";

export const metadata: Metadata = { title: "Quiz" };

/** Learner quiz page: rules, history, and the start / resume button. */
export default async function QuizPage({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const actor = await requireActor();
  const { courseId, lessonId } = await params;
  let s: Awaited<ReturnType<typeof quizStateForLearner>>;
  try {
    s = await quizStateForLearner(prisma, actor, lessonId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Locked">{e.message}</Banner>;
    throw e;
  }
  if (s.lesson.courseId !== courseId) notFound();
  const l = s.lesson;

  return (
    <>
      <Link href={`/courses/${courseId}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> {l.courseTitle}</Link>
      <PageHeader eyebrow={l.contentType === "ASSESSMENT" ? "Assessment" : l.contentType === "AUDIO" ? "Audiobook quiz" : "Quiz"} title={l.title} description={l.description ?? `${l.questionCount} question${l.questionCount === 1 ? "" : "s"} · pass at ${l.passingScore}%${l.timeLimitMin ? ` · ${l.timeLimitMin} minutes` : ""} · ${l.maxAttempts ? `${l.maxAttempts} attempt${l.maxAttempts === 1 ? "" : "s"}` : "unlimited attempts"}`} />

      {s.passed && <div className="mb-6"><Banner tone="success" title={`Passed${s.progress?.completedAt ? ` · ${fmtDate(s.progress.completedAt)}` : ""}`}>Your counting score is {s.countingScore ?? "—"}% ({l.scorePolicy === "LATEST" ? "latest attempt" : "highest attempt"}).{s.canStart ? " You can still retake it." : ""}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {l.body && <Card title="Before you start"><p className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">{l.body}</p></Card>}
          <Card title="Your attempts">
            {s.attempts.length === 0 ? <EmptyState title="No attempts yet" /> : (
              <ul className="divide-y divide-ink-100 text-[14px]">
                {s.attempts.map((a, i) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5">
                    <span className="text-ink-600">Attempt {s.attempts.length - i} · {fmtDate(a.submittedAt ?? a.startedAt)}</span>
                    <span className="flex items-center gap-3">
                      <span className={a.passed ? "font-semibold text-brand-700" : a.status === "PENDING_REVIEW" ? "font-semibold text-gold-700" : "font-semibold text-ink-700"}>{a.status === "PENDING_REVIEW" ? "Awaiting review" : a.status === "EXPIRED" ? "Timed out" : `${a.scorePercent ?? "—"}% · ${a.passed ? "Passed" : "Not passed"}`}</span>
                      <Link href={`/courses/attempt/${a.id}`} className="text-[12.5px] font-semibold text-brand-600">Review</Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title={s.openAttemptId ? "Attempt in progress" : "Start"}>
            <dl className="mb-4 space-y-2 text-[13.5px]">
              <div className="flex justify-between"><dt className="text-ink-500">Questions</dt><dd className="font-medium text-ink-800">{l.questionCount}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Passing score</dt><dd className="font-medium text-ink-800">{l.passingScore}%</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Attempts used</dt><dd className="font-medium text-ink-800">{s.attemptsUsed}{l.maxAttempts ? ` / ${l.maxAttempts}` : ""}</dd></div>
              {l.timeLimitMin && <div className="flex justify-between"><dt className="text-ink-500">Time limit</dt><dd className="font-medium text-ink-800">{l.timeLimitMin} min</dd></div>}
            </dl>
            {s.canStart ? (
              <StartQuizButton lessonId={l.id} label={s.openAttemptId ? "Resume attempt" : s.attemptsUsed > 0 ? "Retake quiz" : "Start quiz"} />
            ) : (
              <p className="flex items-start gap-2 rounded-2xl bg-ink-50 px-3.5 py-3 text-[13.5px] text-ink-600">{s.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />} {s.blocked}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
