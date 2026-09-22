import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listAllCoursesForStaff, listTemplatesForAdmin } from "@/server/services/academy.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { CourseWorkflowButton } from "@/components/academy/CourseActions";

export const metadata: Metadata = { title: "Academy · Courses" };

export default async function StaffAcademyCoursesPage() {
  const actor = await requireActor();
  let courses: Awaited<ReturnType<typeof listAllCoursesForStaff>>;
  try {
    courses = await listAllCoursesForStaff(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Course management requires course.manage">Use the Payments or Certifications tabs.</Banner>;
    throw e;
  }
  const templates = await listTemplatesForAdmin(prisma, actor);
  const pending = courses.filter((c) => c.status === "PENDING_APPROVAL");
  const others = courses.filter((c) => c.status !== "PENDING_APPROVAL");

  return (
    <div className="space-y-5">
      <Card title="Awaiting publication" description="Coach-submitted courses. Check the syllabus and exam on the coach page, choose a certification template, and publish.">
        {pending.length === 0 ? <EmptyState title="Nothing waiting" /> : (
          <ul className="divide-y divide-ink-100">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <Link href={`/coach/courses/${c.id}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.title}</Link>
                  <p className="text-[12.5px] text-ink-400">{c.category} · {c.priceLabel} · by {c.ownerCoach.email} · {c.exam?.questions.length ?? 0} questions{c.requiresCoachReview ? " · coach review required" : ""}</p>
                </div>
                <div className="w-full md:w-[300px]"><CourseWorkflowButton courseId={c.id} op="PUBLISH" label="Publish" variant="primary" templates={templates.map((t) => ({ id: t.id, name: t.name }))} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="All courses">
        {others.length === 0 ? <EmptyState title="No courses yet" /> : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-3 font-semibold">Course</th><th className="pb-3 font-semibold">Coach</th><th className="pb-3 font-semibold">Price</th><th className="pb-3 font-semibold">Enrolled</th><th className="pb-3 font-semibold">Certification</th><th className="pb-3 font-semibold">Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {others.map((c) => (
                <tr key={c.id}>
                  <td className="py-3"><Link href={`/coach/courses/${c.id}`} className="font-semibold text-brand-600">{c.title}</Link><span className="block text-[12px] text-ink-400">{c.category}{c.publishedAt ? ` · ${fmtDate(c.publishedAt)}` : ""}</span></td>
                  <td className="py-3 text-ink-600">{c.ownerCoach.email}</td>
                  <td className="py-3 font-semibold text-ink-800">{c.priceLabel}</td>
                  <td className="py-3 text-ink-600">{c.enrolledCount}</td>
                  <td className="py-3 text-ink-600">{c.certificationTemplate?.name ?? "—"}</td>
                  <td className="py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
