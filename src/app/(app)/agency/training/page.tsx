import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { trainingCatalog, agencyTrainingOverview } from "@/server/services/training.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, EmptyState, Banner, StatusBadge, fmtDate } from "@/components/app/ui";
import { BuyCourseSeatsForm, AssignCourseForm } from "@/components/agency/TrainingPanels";

export const metadata: Metadata = { title: "Training" };

/** v2 phase 4: the agency's training: catalog, Course Seats, assignments, and members' credentials with source and status. */
export default async function AgencyTrainingPage() {
  const actor = await requireActor();
  let catalog: Awaited<ReturnType<typeof trainingCatalog>>;
  let members: Awaited<ReturnType<typeof agencyTrainingOverview>>;
  try {
    [catalog, members] = await Promise.all([trainingCatalog(prisma, actor), agencyTrainingOverview(prisma, actor)]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Your owner has not granted you access to training.</Banner>;
    throw e;
  }
  const active = actor.agency?.status === "ACTIVE";
  const canBuy = actor.permissions.has("agency.training.purchase");
  const canAssign = actor.permissions.has("agency.training.assign");
  const assignable = members.filter((m) => m.membershipStatus === "ACTIVE").map((m) => ({ agentProfileId: m.agentProfileId, displayName: m.displayName }));
  const pending = catalog.purchases.filter((p) => p.status === "PENDING");
  return (
    <div className="space-y-5">
      <Banner tone="info" title="Course Seats are not Agent Seats">Agent Seats are how many agents you may have. Course Seats are purchased per course and assigned to members; the enrollment, certification, and assessment they produce are sponsored by you and stop counting for platform use if the member leaves your agency.</Banner>
      <Card title="Catalog" description="Published Hirewise courses. Buy Course Seats for paid courses; free courses can be assigned directly.">
        {catalog.courses.length === 0 ? <EmptyState title="No published courses yet" /> : (
          <ul className="divide-y divide-ink-100">
            {catalog.courses.map((c) => (
              <li key={c.id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">{c.title} <span className="font-normal text-ink-400">· {c.category}</span></p>
                    <p className="text-[12.5px] text-ink-500">{c.priceLabel} · {c.modules} module(s){c.certification ? ` · certification: ${c.certification}` : ""}</p>
                  </div>
                  {c.priceCents > 0 && <p className="text-[13px] text-ink-600"><span className="font-semibold">{c.seatsAvailable}</span> seat(s) available · {c.seatsUsed} assigned of {c.seatsBought} bought</p>}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {canBuy && c.priceCents > 0 && <BuyCourseSeatsForm course={c} disabled={!active} />}
                  {canAssign && <AssignCourseForm course={c} members={assignable} disabled={!active} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {catalog.purchases.length > 0 && (
        <Card title="Course Seat purchases" description={pending.length ? `${pending.length} waiting for Hirewise to record the payment.` : "Recorded by Hirewise."}>
          <ul className="divide-y divide-ink-100 text-[13.5px]">{catalog.purchases.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-ink-700">{p.courseTitle} · {p.seatCount} seat(s) · {p.amountLabel} · {fmtDate(p.createdAt)}{p.paymentReference ? ` · ref ${p.paymentReference}` : ""}{p.status === "PAID" || p.status === "WAIVED" ? ` · ${p.assigned} assigned` : ""}</span><StatusBadge status={p.status} /></li>)}</ul>
        </Card>
      )}
      <Card title={`Members' training (${members.length})`} description="Courses, certifications, and assessments with their source. Only active items count for eligibility.">
        {members.length === 0 ? <EmptyState title="No members yet" /> : (
          <ul className="divide-y divide-ink-100">
            {members.map((m) => (
              <li key={m.membershipId} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[15px] font-semibold text-ink-900">{m.displayName} <span className="font-normal text-ink-400">· {m.primaryRole ?? "Talent"} · {m.verificationLevel.replace(/_/g, " ").toLowerCase()}</span></p><StatusBadge status={m.membershipStatus} /></div>
                <div className="mt-2 grid gap-4 text-[13px] md:grid-cols-3">
                  <div><p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Courses</p>{m.courses.length === 0 ? <p className="text-ink-400">None</p> : <ul className="mt-1 space-y-0.5">{m.courses.map((c) => <li key={c.enrollmentId} className={c.revoked ? "text-ink-400 line-through" : "text-ink-700"}>{c.title} · {c.revoked ? "revoked" : c.status.toLowerCase().replace(/_/g, " ")} · {c.percent}% · {c.source}</li>)}</ul>}</div>
                  <div><p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Certifications</p>{m.certifications.length === 0 ? <p className="text-ink-400">None</p> : <ul className="mt-1 space-y-0.5">{m.certifications.map((c) => <li key={c.id} className={c.active ? "text-ink-700" : "text-ink-400"}>{c.name} · {c.status.toLowerCase().replace(/_/g, " ")} · {c.source}</li>)}</ul>}</div>
                  <div><p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Assessments</p>{m.assessments.length === 0 ? <p className="text-ink-400">None</p> : <ul className="mt-1 space-y-0.5">{m.assessments.map((a) => <li key={a.id} className={a.active ? "text-ink-700" : "text-ink-400"}>{a.type.toLowerCase().replace(/_/g, " ")}{a.label ? ` · ${a.label}` : ""} · {a.status.toLowerCase()} · {a.source}</li>)}</ul>}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
