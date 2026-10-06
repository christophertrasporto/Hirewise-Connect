import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { getLessonForCoach } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";
import { Card } from "@/components/app/ui";
import { LessonForm } from "@/components/academy/CurriculumEditor";
import { LessonContent } from "@/components/academy/LessonContent";
import { LESSON_TYPE_META } from "@/components/academy/lesson-meta";
import { QuestionBuilder } from "@/components/academy/QuestionBuilder";
import { cn } from "@/lib/cn";
import { loadBuilderCourse } from "../../load";

export const metadata: Metadata = { title: "Lesson" };

const TABS = ["content", "questions", "settings", "preview"] as const;
type Tab = (typeof TABS)[number];

/** One lesson: Content / Questions / Settings / Preview, so a coach never has to leave the page. */
export default async function LessonPage({ params, searchParams }: { params: Promise<{ id: string; lessonId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id, lessonId } = await params;
  const { actor, course } = await loadBuilderCourse(id);
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "content";
  let lesson: Awaited<ReturnType<typeof getLessonForCoach>>["lesson"];
  try {
    lesson = (await getLessonForCoach(prisma, actor, id, lessonId)).lesson;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const meta = LESSON_TYPE_META[lesson.contentType];
  const hasQuestions = lesson.contentType === "QUIZ" || lesson.contentType === "ASSESSMENT" || lesson.contentType === "AUDIO";
  const modules = course.modules.map((m) => ({ id: m.id, title: m.title }));
  const value = {
    id: lesson.id, title: lesson.title, contentType: lesson.contentType, description: lesson.description, body: lesson.body, url: lesson.url, fileName: lesson.fileName, contentMime: lesson.contentMime, sizeBytes: lesson.sizeBytes, durationSec: lesson.durationSec, hasFile: !!lesson.storageKey,
    isRequired: lesson.isRequired, status: lesson.status, requiredPercent: lesson.requiredPercent, passingScore: lesson.passingScore, maxAttempts: lesson.maxAttempts, timeLimitMin: lesson.timeLimitMin, randomizeCount: lesson.randomizeCount, shuffleAnswers: lesson.shuffleAnswers, showCorrectAnswers: lesson.showCorrectAnswers, showExplanations: lesson.showExplanations, retakeWaitMinutes: lesson.retakeWaitMinutes, scorePolicy: lesson.scorePolicy, reviewMode: lesson.reviewMode, dueAt: lesson.dueAt, points: lesson.points, submissionType: lesson.submissionType, questionCount: lesson.questions.length,
  };
  const base = `/courses/manage/${course.id}/lessons/${lesson.id}`;

  return (
    <>
      <Link href={`/courses/manage/${course.id}/modules`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Modules & Lessons</Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-50 text-ink-600 ring-1 ring-inset ring-ink-100"><meta.icon className="h-4 w-4" /></span>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{lesson.module.title} · {meta.label}</p>
          <h2 className="text-[20px] font-bold text-ink-900">{lesson.title}</h2>
        </div>
        <span className="ml-auto text-[12.5px] text-ink-400">{lesson.status === "PUBLISHED" ? "Published" : "Draft"} · {lesson.isRequired ? "Required" : "Optional"} · v{lesson.version}{lesson._count.attempts ? ` · ${lesson._count.attempts} attempt${lesson._count.attempts === 1 ? "" : "s"}` : ""}</span>
      </div>
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Lesson sections">
        {TABS.map((t) => (
          <Link key={t} href={t === "content" ? base : `${base}?tab=${t}`} className={cn("rounded-full border px-4 py-1.5 text-[13.5px] font-semibold capitalize", tab === t ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")} aria-current={tab === t ? "page" : undefined}>
            {t}{t === "questions" && hasQuestions ? ` (${lesson.questions.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "content" && <Card title="Content"><LessonForm courseId={course.id} modules={modules} moduleId={lesson.moduleId} lesson={value} section="content" /></Card>}
      {tab === "settings" && <Card title="Settings"><LessonForm courseId={course.id} modules={modules} moduleId={lesson.moduleId} lesson={value} section="settings" /></Card>}
      {tab === "questions" && (
        <Card title="Questions" description={hasQuestions ? "Multiple choice, multiple correct answers, true/false, or short answer. Add as many as you need. Editing a question that learners have already answered starts a new version; their attempts keep the old one." : undefined}>
          {hasQuestions ? (
            <QuestionBuilder courseId={course.id} lessonId={lesson.id} questions={lesson.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, explanation: q.explanation, points: q.points, isRequired: q.isRequired, state: q.state === "SUGGESTED" ? "DRAFT" : q.state, keywords: q.keywords, version: q.version, choices: q.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })) }))} />
          ) : (
            <p className="text-[14px] text-ink-500">{meta.label} lessons have no questions. Change the lesson type to Quiz, Assessment, or Audio to add some.</p>
          )}
        </Card>
      )}
      {tab === "preview" && (
        <Card title="Preview" description="What an enrolled learner sees. Drafts are shown here even though learners cannot open them.">
          {lesson.contentType === "QUIZ" || lesson.contentType === "ASSESSMENT" || lesson.contentType === "ASSIGNMENT" ? (
            <div className="space-y-3 text-[14px] text-ink-700">
              {lesson.description && <p className="text-ink-500">{lesson.description}</p>}
              {lesson.body && <p className="whitespace-pre-line">{lesson.body}</p>}
              <p className="text-[13px] text-ink-400">{lesson.contentType === "ASSIGNMENT" ? `Submission: ${lesson.submissionType ?? "not set"}${lesson.dueAt ? ` · due ${new Date(lesson.dueAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}` : ""}${lesson.points ? ` · ${lesson.points} points` : ""}` : `${lesson.questions.length} question${lesson.questions.length === 1 ? "" : "s"} · pass ${lesson.passingScore ?? course.passingScore}% · ${lesson.maxAttempts ? `${lesson.maxAttempts} attempt${lesson.maxAttempts === 1 ? "" : "s"}` : "unlimited attempts"}${lesson.timeLimitMin ? ` · ${lesson.timeLimitMin} min` : ""}`}</p>
            </div>
          ) : (
            <LessonContent modules={[{ id: lesson.module.id, title: lesson.module.title, description: null, lessons: [{ id: lesson.id, title: lesson.title, contentType: lesson.contentType, durationSec: lesson.durationSec, body: lesson.body, url: lesson.url, hasFile: !!lesson.storageKey, fileName: lesson.fileName, contentMime: lesson.contentMime, sizeBytes: lesson.sizeBytes }] }]} />
          )}
        </Card>
      )}
    </>
  );
}
