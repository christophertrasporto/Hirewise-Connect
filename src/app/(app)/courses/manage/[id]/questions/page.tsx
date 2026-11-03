import type { Metadata } from "next";
import { canHoldQuestions } from "@/lib/lesson-questions";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { listQuestionBank } from "@/server/services/question-bank.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, Banner } from "@/components/app/ui";
import { QuestionBank } from "@/components/academy/QuestionBank";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Question bank" };

/** All of a course's questions in one place: search, filter by lesson, topic, difficulty, type; reuse across lessons. */
export default async function QuestionBankPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; topic?: string; difficulty?: string; type?: string; location?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor, course } = await loadBuilderCourse(id);
  let bank: Awaited<ReturnType<typeof listQuestionBank>>;
  try {
    bank = await listQuestionBank(prisma, actor, course.id, sp);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Building questions needs the course.quiz.build permission.</Banner>;
    throw e;
  }
  // Every lesson that can hold questions, not only the ones that already have some, so a question can be assigned to any of them.
  const allLessons = course.modules.flatMap((m) => m.lessons.filter((l) => canHoldQuestions(l.contentType)).map((l) => ({ id: l.id, title: l.title, module: m.title })));
  return (
    <>
      <Link href={`/courses/manage/${course.id}/modules`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Modules & Lessons</Link>
      <Card title="Question bank" description="Every question in this course, organised by lesson, topic, and difficulty. Reuse a question in another quiz, keep bank-only questions for later, or write new ones here. Coaches can still add questions directly on any lesson page.">
        <QuestionBank courseId={course.id} items={bank.items} topics={bank.topics} lessons={allLessons} filters={sp} total={bank.total} bankOnly={bank.bankOnly} />
      </Card>
    </>
  );
}
