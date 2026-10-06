import type { Metadata } from "next";
import { Card } from "@/components/app/ui";
import { CurriculumEditor } from "@/components/academy/CurriculumEditor";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Modules & Lessons" };

export default async function ModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { course } = await loadBuilderCourse(id);
  return (
    <Card title="Modules & Lessons" description="Course → Module → Lesson. The lesson type decides which fields you see. Questions for quizzes, assessments, and audiobooks are built on the lesson page. Editable at any time, including after publishing.">
      <CurriculumEditor courseId={course.id} modules={course.modules.map((m) => ({ id: m.id, title: m.title, description: m.description, isRequired: m.isRequired, status: m.status, lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, contentType: l.contentType, description: l.description, body: l.body, url: l.url, fileName: l.fileName, contentMime: l.contentMime, sizeBytes: l.sizeBytes, durationSec: l.durationSec, hasFile: !!l.storageKey, isRequired: l.isRequired, status: l.status, requiredPercent: l.requiredPercent, passingScore: l.passingScore, maxAttempts: l.maxAttempts, timeLimitMin: l.timeLimitMin, randomizeCount: l.randomizeCount, shuffleAnswers: l.shuffleAnswers, showCorrectAnswers: l.showCorrectAnswers, showExplanations: l.showExplanations, retakeWaitMinutes: l.retakeWaitMinutes, scorePolicy: l.scorePolicy, reviewMode: l.reviewMode, dueAt: l.dueAt, points: l.points, submissionType: l.submissionType, questionCount: l.questionCount })) }))} />
    </Card>
  );
}
