import type { Metadata } from "next";
import Link from "next/link";
import { Award } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { catalogForAgent, academyLockFor, listCoursesForCoach } from "@/server/services/academy.service";
import { myCourses } from "@/server/services/learner.service";
import { CourseCards, ContinueLearning } from "@/components/academy/CourseCards";
import { CourseCatalog } from "@/components/academy/CourseCatalog";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader, Card, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { can } from "@/server/policies/authorize";
import { BuilderHome } from "@/components/academy/BuilderHome";

export const metadata: Metadata = { title: "Courses" };

export default async function AcademyPage() {
  const actor = await requireActor();
  if (actor.role !== "AGENT") {
    if (can(actor, "course.create_own") || can(actor, "course.manage") || can(actor, "course.payment.record") || can(actor, "certification.review")) {
      const builderCourses = can(actor, "course.create_own") || can(actor, "course.manage") ? await listCoursesForCoach(prisma, actor) : [];
      return <BuilderHome actor={actor} courses={builderCourses} />;
    }
    return <Banner tone="warn" title="No course access">Courses are for talent, coaches, and Academy administrators.</Banner>;
  }
  const [courses, profile, lock, mineCards] = await Promise.all([catalogForAgent(prisma, actor), getOwnProfile(prisma, actor), academyLockFor(prisma, actor), myCourses(prisma, actor)]);
  const mine = courses.filter((c) => c.enrollment);
  const available = courses.filter((c) => !c.enrollment);
  const resume = mineCards.cards.find((c) => c.status === "IN_PROGRESS") ?? null;

  return (
    <>
      <PageHeader eyebrow="Hirewise VA Academy" title="Courses and certifications" description="Complete courses, pass the exam, and earn certifications that raise your verification level and show on your profile to clients." />

      {lock.locked && (
        <div className="mb-6">
          <Banner tone="warn" title="Courses are locked until you finish onboarding">
            {lock.reason} <Link href="/onboarding/welcome-video" className="font-semibold underline underline-offset-2">Watch it now</Link>.
          </Banner>
        </div>
      )}

      {profile.certifications.filter((c) => c.status === "APPROVED").length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {profile.certifications.filter((c) => c.status === "APPROVED").map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-3 py-1.5 text-[13px] font-semibold text-gold-800 ring-1 ring-inset ring-gold-200"><Award className="h-4 w-4" /> {c.name}{c.expiresAt ? <span className="font-normal text-gold-600">· until {fmtDate(c.expiresAt)}</span> : null}</span>
          ))}
        </div>
      )}

      {resume && (
        <section className="mb-8" aria-label="Continue learning">
          <ContinueLearning card={resume} />
        </section>
      )}

      {mine.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">My courses</h2>
            <p className="text-[12.5px] text-ink-400">{mineCards.inProgress} in progress · {mineCards.completed} completed · {mineCards.certifications} certification{mineCards.certifications === 1 ? "" : "s"}</p>
          </div>
          <CourseCards cards={mineCards.cards} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Catalog</h2>
        {available.length === 0 ? (
          <Card><EmptyState title={mine.length ? "You are enrolled in every published course" : "No courses published yet"} description="Coaches are preparing new courses. Check back soon." /></Card>
        ) : (
          <CourseCatalog courses={available.map((c) => ({ id: c.id, title: c.title, category: c.category, description: c.description, difficulty: c.difficulty, coverUrl: c.coverUrl, priceCents: c.priceCents, priceLabel: c.priceLabel, lessonCount: c.lessonCount, questionCount: c.questionCount, certification: !!c.certification, locked: c.locked }))} />
        )}
      </section>
    </>
  );
}
