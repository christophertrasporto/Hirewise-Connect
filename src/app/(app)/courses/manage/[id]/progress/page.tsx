import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { learnerTracking, TRACKING_STATUSES, type TrackingStatus } from "@/server/services/tracking.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, Banner } from "@/components/app/ui";
import { TrackingFilters, TrackingTable } from "@/components/academy/TrackingTable";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Progress" };

/** This course's tracking table: the same columns as the cross-course page, filtered to one course. */
export default async function ProgressPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor, course } = await loadBuilderCourse(id);
  const status = (TRACKING_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as TrackingStatus) : "";
  const required = course.modules.filter((m) => m.status === "PUBLISHED").flatMap((m) => m.lessons).filter((l) => l.status === "PUBLISHED" && l.isRequired).length;
  let data: Awaited<ReturnType<typeof learnerTracking>>;
  try {
    data = await learnerTracking(prisma, actor, { courseId: course.id, status, q: sp.q || undefined });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Learner progress needs the learner.progress.read permission.</Banner>;
    throw e;
  }
  return (
    <Card title="Learner progress" description={`Progress is ${required} required lesson${required === 1 ? "" : "s"}${course.completionRequiresFinalAssessment ? " plus the final assessment" : ""}. Listening is the average across audio lessons; quiz cells show the best score and attempt count.`}>
      <TrackingFilters courses={[]} coaches={[]} values={{ status, q: sp.q }} fixedCourseId={course.id} action={`/courses/manage/${course.id}/progress`} />
      <TrackingTable rows={data.rows} showCourse={false} />
    </Card>
  );
}
