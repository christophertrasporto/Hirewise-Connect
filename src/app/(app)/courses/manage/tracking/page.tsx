import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { learnerTracking, TRACKING_STATUSES, type TrackingStatus } from "@/server/services/tracking.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { TrackingFilters, TrackingTable } from "@/components/academy/TrackingTable";

export const metadata: Metadata = { title: "Learner progress" };

/** Admin / Coach tracking table across courses, with filters by course, coach, status, and learner. */
export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ courseId?: string; coachUserId?: string; status?: string; q?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = (TRACKING_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as TrackingStatus) : "";
  let data: Awaited<ReturnType<typeof learnerTracking>>;
  try {
    data = await learnerTracking(prisma, actor, { courseId: sp.courseId || undefined, coachUserId: sp.coachUserId || undefined, status, q: sp.q || undefined });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Learner progress is visible to coaches and Academy administrators.</Banner>;
    throw e;
  }
  const counts = { total: data.rows.length, completed: data.rows.filter((r) => r.status === "COMPLETED").length, inProgress: data.rows.filter((r) => r.status === "IN_PROGRESS").length, failed: data.rows.filter((r) => r.status === "FAILED").length };
  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader eyebrow="Courses" title="Learner progress" description="Every enrolment across your courses: progress, where each learner is, listening and quiz results, assignments, completion, and certification." />
      <Card title={`${counts.total} enrolment${counts.total === 1 ? "" : "s"}`} description={`${counts.completed} completed · ${counts.inProgress} in progress · ${counts.failed} failed`}>
        <TrackingFilters courses={data.courses} coaches={data.coaches} values={{ courseId: sp.courseId, coachUserId: sp.coachUserId, status, q: sp.q }} action="/courses/manage/tracking" />
        <TrackingTable rows={data.rows} />
      </Card>
    </>
  );
}
