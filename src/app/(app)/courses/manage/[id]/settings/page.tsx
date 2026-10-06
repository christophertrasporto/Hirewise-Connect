import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { listCoursesForCoach } from "@/server/services/academy.service";
import { Card } from "@/components/app/ui";
import { CourseSettingsForm } from "@/components/academy/CourseSettingsForm";
import { CourseWorkflowButton } from "@/components/academy/CourseActions";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Course settings" };

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, course } = await loadBuilderCourse(id);
  const others = (await listCoursesForCoach(prisma, actor)).filter((c) => c.id !== course.id).map((c) => ({ id: c.id, title: c.title }));
  const isAdmin = actor.permissions.has("course.manage");
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card title="Learning rules" description="Completion, unlocking, prerequisites, and who may enrol. Changing a rule never deletes any learner's history; course progress is recalculated.">
        <CourseSettingsForm otherCourses={others} values={{ courseId: course.id, isRequired: course.isRequired, sequentialUnlock: course.sequentialUnlock, completionRequiresQuizPass: course.completionRequiresQuizPass, completionRequiresFinalAssessment: course.completionRequiresFinalAssessment, displayOrder: course.displayOrder, prerequisiteIds: course.prerequisites.map((p) => p.id), minVerificationLevel: course.accessRules?.minVerificationLevel ?? "" }} />
      </Card>
      <div className="space-y-5">
        <Card title="Danger zone">
          {isAdmin && course.status === "PUBLISHED" ? <CourseWorkflowButton courseId={course.id} op="ARCHIVE" label="Archive course" variant="outline" confirm="Archive this course? Enrolled learners keep their progress but new enrolments stop." /> : <p className="text-[13.5px] text-ink-500">{course.status === "ARCHIVED" ? "This course is archived." : isAdmin ? "Archiving is available once the course is published." : "Only Admin can archive a published course."}</p>}
        </Card>
      </div>
    </div>
  );
}
