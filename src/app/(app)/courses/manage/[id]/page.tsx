import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { listCategories } from "@/server/services/category.service";
import { listTemplatesForAdmin } from "@/server/services/academy.service";
import { Card, Banner } from "@/components/app/ui";
import { CourseForm } from "@/components/academy/CourseForm";
import { CourseWorkflowButton } from "@/components/academy/CourseActions";
import { loadBuilderCourse } from "./load";

export const metadata: Metadata = { title: "Course overview" };

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, course } = await loadBuilderCourse(id);
  const isAdmin = actor.permissions.has("course.manage");
  const [categories, templates] = await Promise.all([listCategories(prisma), isAdmin ? listTemplatesForAdmin(prisma, actor) : Promise.resolve([])]);
  const quizLessons = course.modules.flatMap((m) => m.lessons).filter((l) => l.contentType === "QUIZ" || l.contentType === "ASSESSMENT" || l.contentType === "AUDIO");
  const emptyQuizzes = quizLessons.filter((l) => l.questionCount === 0);

  return (
    <>
      {course.status === "DRAFT" && <div className="mb-6"><Banner tone="info" title="Draft">Build the modules and lessons, then submit the course. Admin links a certification template and publishes it to the catalog.</Banner></div>}
      {course.status === "PENDING_APPROVAL" && <div className="mb-6"><Banner tone="warn" title="Waiting for Admin approval">You can keep editing everything in the meantime.</Banner></div>}
      {course.status === "PUBLISHED" && <div className="mb-6"><Banner tone="success" title="Live in the catalog">Everything stays editable. Saved changes reach enrolled learners immediately; their progress and past attempts are never erased.</Banner></div>}
      {emptyQuizzes.length > 0 && <div className="mb-6"><Banner tone="warn" title={`${emptyQuizzes.length} lesson${emptyQuizzes.length === 1 ? " has" : "s have"} no questions yet`}>{emptyQuizzes.map((l) => l.title).join(", ")}. Open the lesson to add questions.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card title="Course details">
          <CourseForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} course={{ id: course.id, title: course.title, categoryId: course.categoryId, description: course.description, difficulty: course.difficulty, estimatedMinutes: course.estimatedMinutes, introVideoUrl: course.introVideoUrl, welcomeMessage: course.welcomeMessage, syllabus: course.syllabus, contentUrl: course.contentUrl, priceCents: course.priceCents, passingScore: course.passingScore, requiresCoachReview: course.requiresCoachReview }} />
        </Card>
        <div className="space-y-5">
          <Card title="Publishing">
            <div className="space-y-3">
              {course.status === "DRAFT" && <CourseWorkflowButton courseId={course.id} op="SUBMIT" label="Submit for publishing" variant="primary" />}
              {isAdmin && (course.status === "PENDING_APPROVAL" || course.status === "DRAFT") && <CourseWorkflowButton courseId={course.id} op="PUBLISH" label="Publish to catalog" variant="dark" templates={templates.map((t) => ({ id: t.id, name: t.name }))} />}
              {isAdmin && course.status === "PUBLISHED" && <CourseWorkflowButton courseId={course.id} op="ARCHIVE" label="Archive course" variant="outline" confirm="Archive this course? Enrolled learners keep their progress but new enrolments stop." />}
              {course.status === "PUBLISHED" && !isAdmin && <p className="text-[13.5px] text-ink-500">Live in the catalog. Keep improving it here; contact Admin only to archive.</p>}
              {course.status === "ARCHIVED" && <p className="text-[13.5px] text-ink-500">Archived. Enrolled learners keep access.</p>}
            </div>
          </Card>
          <Card title="Coaches">
            <ul className="space-y-1 text-[14px] text-ink-700">
              <li>{course.ownerCoach.email} <span className="text-ink-400">· owner</span></li>
              {course.coaches.filter((c) => c.id !== course.ownerCoach.id).map((c) => <li key={c.id}>{c.email}</li>)}
            </ul>
            <p className="mt-2 text-[12.5px] text-ink-400">Admin assigns additional coaches. Coaches only see courses they own or are assigned to.</p>
          </Card>
          <Card title="At a glance">
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between"><dt className="text-ink-500">Difficulty</dt><dd className="font-medium text-ink-800">{course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Estimated</dt><dd className="font-medium text-ink-800">{course.estimatedMinutes ? `${Math.round(course.estimatedMinutes / 60 * 10) / 10} h` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Required lessons</dt><dd className="font-medium text-ink-800">{course.modules.flatMap((m) => m.lessons).filter((l) => l.isRequired).length} of {course.lessonCount}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Sequential unlock</dt><dd className="font-medium text-ink-800">{course.sequentialUnlock ? "On" : "Off"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Price</dt><dd className="font-medium text-ink-800">{course.priceLabel}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
