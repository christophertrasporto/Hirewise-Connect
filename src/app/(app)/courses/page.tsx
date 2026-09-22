import type { Metadata } from "next";
import Link from "next/link";
import { Award, BookOpen, CheckCircle2, Lock } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { catalogForAgent } from "@/server/services/academy.service";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Academy" };

export default async function AcademyPage() {
  const actor = await requireActor();
  if (actor.role !== "AGENT") return <Banner tone="warn" title="Talent only">The Academy catalog is for talent accounts. Coaches use the Coach console.</Banner>;
  const [courses, profile] = await Promise.all([catalogForAgent(prisma, actor), getOwnProfile(prisma, actor)]);
  const mine = courses.filter((c) => c.enrollment);
  const available = courses.filter((c) => !c.enrollment);

  return (
    <>
      <PageHeader eyebrow="Hirewise VA Academy" title="Courses and certifications" description="Complete courses, pass the exam, and earn certifications that raise your verification level and show on your profile to clients." />

      {profile.certifications.filter((c) => c.status === "APPROVED").length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {profile.certifications.filter((c) => c.status === "APPROVED").map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-3 py-1.5 text-[13px] font-semibold text-gold-800 ring-1 ring-inset ring-gold-200"><Award className="h-4 w-4" /> {c.name}{c.expiresAt ? <span className="font-normal text-gold-600">· until {fmtDate(c.expiresAt)}</span> : null}</span>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">My courses</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {mine.map((c) => {
              const e = c.enrollment!;
              const locked = e.paymentStatus === "PENDING";
              return (
                <Link key={c.id} href={`/courses/${c.id}`} className="group rounded-3xl border border-ink-100 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-600">{c.category}</p>
                      <h3 className="mt-1 text-[17px] font-bold text-ink-900 group-hover:text-brand-700">{c.title}</h3>
                    </div>
                    {e.status === "COMPLETED" ? <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-500" /> : locked ? <Lock className="h-5 w-5 shrink-0 text-gold-500" /> : <BookOpen className="h-5 w-5 shrink-0 text-ink-300" />}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-500">
                    <StatusBadge status={e.status} />
                    {e.priceCents > 0 && <StatusBadge status={e.paymentStatus} />}
                    {e.examScore !== null && <span>Exam {e.examScore}%</span>}
                    {e.completedAt && <span>Completed {fmtDate(e.completedAt)}</span>}
                  </div>
                  {locked && <p className="mt-3 rounded-xl bg-gold-50 px-3 py-2 text-[12.5px] text-gold-700">Pay {e.priceLabel} to Hirewise to unlock. Your coach or account manager will confirm the payment.</p>}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Catalog</h2>
        {available.length === 0 ? (
          <Card><EmptyState title={mine.length ? "You are enrolled in every published course" : "No courses published yet"} description="Coaches are preparing new courses. Check back soon." /></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {available.map((c) => (
              <Link key={c.id} href={`/courses/${c.id}`} className="group flex flex-col rounded-3xl border border-ink-100 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-600">{c.category}</p>
                <h3 className="mt-1 text-[17px] font-bold text-ink-900 group-hover:text-brand-700">{c.title}</h3>
                <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-ink-600">{c.description}</p>
                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className={cn("rounded-full px-3 py-1 text-[13px] font-bold", c.priceCents === 0 ? "bg-brand-50 text-brand-700" : "bg-ink-900 text-white")}>{c.priceLabel}</span>
                  <span className="text-[12.5px] text-ink-400">{c.questionCount} question exam{c.certification ? " · certification" : ""}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
