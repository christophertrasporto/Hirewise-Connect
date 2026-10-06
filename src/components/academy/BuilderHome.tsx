import Link from "next/link";
import { Plus, Tags, Users, Wallet, Award, PlayCircle, LayoutList, BarChart3 } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/policies/authorize";
import type { listCoursesForCoach } from "@/server/services/academy.service";
import { PageHeader, Card, StatusBadge, EmptyState, StatTile } from "@/components/app/ui";

export type BuilderCourseRow = Awaited<ReturnType<typeof listCoursesForCoach>>[number];

/**
 * "Courses" for coaches and Academy administrators: every course they may build, plus links to the
 * administration areas. One entry point; a coach rarely needs to leave the builder.
 */
export function BuilderHome({ actor, courses }: { actor: Actor; courses: BuilderCourseRow[] }) {
  const manages = can(actor, "course.manage");
  const builds = manages || can(actor, "course.create_own");
  const pending = courses.filter((c) => c.status === "PENDING_APPROVAL").length;
  const links = [
    manages || can(actor, "learner.progress.read") ? { href: "/courses/manage/tracking", label: "Learner progress", icon: BarChart3 } : null,
    builds ? { href: "/coach", label: "Learners & assessments", icon: Users } : null,
    manages ? { href: "/staff/academy", label: pending ? `Approvals (${pending})` : "Approvals", icon: PlayCircle } : null,
    manages ? { href: "/courses/manage/categories", label: "Categories", icon: Tags } : null,
    can(actor, "course.payment.record") ? { href: "/staff/academy/payments", label: "Payments", icon: Wallet } : null,
    can(actor, "certification.review") ? { href: "/staff/academy/certifications", label: "Certifications", icon: Award } : null,
    manages ? { href: "/staff/academy/onboarding", label: "Onboarding", icon: LayoutList } : null,
  ].filter((l): l is { href: string; label: string; icon: typeof Users } => !!l);

  return (
    <>
      <PageHeader
        eyebrow="Courses"
        title={manages ? "All courses" : "My courses"}
        description="Build structured learning programs: modules, lessons of every type, quizzes, and certification, all from one place. Published courses stay editable."
        actions={builds ? <Link href="/courses/manage/new" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800"><Plus className="h-4 w-4" /> New course</Link> : undefined}
      />

      {links.length > 0 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Course administration">
          {links.map((l) => <Link key={l.href} href={l.href} className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50"><l.icon className="h-4 w-4 text-ink-400" /> {l.label}</Link>)}
        </nav>
      )}

      {builds && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <StatTile label="Courses" value={courses.length} hint={`${courses.filter((c) => c.status === "PUBLISHED").length} published`} />
          <StatTile label="Drafts" value={courses.filter((c) => c.status === "DRAFT").length} />
          <StatTile label="Awaiting approval" value={pending} />
          <StatTile label="Learners" value={courses.reduce((n, c) => n + c.enrolledCount, 0)} hint="Enrolments across these courses" />
        </div>
      )}

      {builds && (
        <Card>
          {courses.length === 0 ? (
            <EmptyState title="No courses yet" description="Create a course, add modules and lessons, build the quiz, and submit it for publishing." action={<Link href="/courses/manage/new" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white"><Plus className="h-4 w-4" /> New course</Link>} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {courses.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/courses/manage/${c.id}`} className="block truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.title}</Link>
                    <p className="text-[12.5px] text-ink-400">{c.category} · {c.priceLabel} · {c.modules.length} module{c.modules.length === 1 ? "" : "s"} · {c.lessonCount} lesson{c.lessonCount === 1 ? "" : "s"} · {c.enrolledCount} enrolled{manages ? ` · ${c.ownerCoach.email}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.status} />
                    <Link href={`/courses/manage/${c.id}/modules`} className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">Open builder</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
