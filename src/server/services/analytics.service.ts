import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorizeAny } from "@/server/policies/authorize";

/**
 * Section 11 analytics dashboard (Phase 5). Each block is included only when the actor's
 * role is listed for it; nothing here joins billing rates with compensation.
 */
export type Bar = { label: string; value: number };

export async function analyticsDashboard(db: PrismaClient, actor: Actor, days = 90) {
  authorizeAny(actor, ["report.talent", "report.pipeline", "report.academy", "client.read"]);
  const since = new Date(Date.now() - days * 86_400_000);
  const can = (k: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(k);

  const talent = can("report.talent")
    ? await (async () => {
        const [registrations, approved, byStatus, approvedRows] = await Promise.all([
          db.agentProfile.count({ where: { createdAt: { gte: since } } }),
          db.agentProfile.count({ where: { approvedAt: { gte: since } } }),
          db.agentProfile.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } }),
          db.agentProfile.findMany({ where: { approvedAt: { gte: since }, submittedAt: { not: null } }, select: { submittedAt: true, approvedAt: true } }),
        ]);
        const durations = approvedRows.map((r) => (r.approvedAt!.getTime() - r.submittedAt!.getTime()) / 86_400_000);
        const submitted = byStatus.reduce((s, r) => s + r._count._all, 0);
        return { registrations, approved, approvalRate: submitted ? Math.round(((byStatus.find((r) => r.status === "APPROVED")?._count._all ?? 0) / submitted) * 100) : 0, medianDaysToApproval: durations.length ? Math.round(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] * 10) / 10 : null, byStatus: byStatus.map((r) => ({ label: r.status, value: r._count._all })) as Bar[] };
      })()
    : null;

  const available = can("report.talent") || can("report.pipeline")
    ? await (async () => {
        const rows = await db.agentProfile.findMany({ where: { status: "APPROVED", availabilityStatus: { in: ["AVAILABLE", "AVAILABLE_SOON"] } }, select: { primaryRole: true, timezone: true, industryExperiences: { select: { industry: true } }, certifications: { where: { status: "APPROVED" }, select: { template: { select: { name: true } } } }, skills: { select: { skill: { select: { name: true } } } } } });
        const count = (get: (r: (typeof rows)[number]) => string[]) => {
          const m = new Map<string, number>();
          for (const r of rows) for (const k of new Set(get(r))) m.set(k, (m.get(k) ?? 0) + 1);
          return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
        };
        return { total: rows.length, byRole: count((r) => [r.primaryRole ?? "Unset"]), byIndustry: count((r) => r.industryExperiences.map((i) => i.industry)), byCertification: count((r) => r.certifications.map((c) => c.template.name)), byTimezone: count((r) => [r.timezone ?? "Unset"]), bySkill: count((r) => r.skills.map((s) => s.skill.name)) };
      })()
    : null;

  const clients = can("client.read")
    ? await (async () => {
        const [registrations, bySource, byStatus] = await Promise.all([db.client.count({ where: { createdAt: { gte: since } } }), db.client.groupBy({ by: ["source"], _count: { _all: true } }), db.client.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } })]);
        return { registrations, bySource: bySource.map((r) => ({ label: r.source ?? "Unknown", value: r._count._all })), byStatus: byStatus.map((r) => ({ label: r.status, value: r._count._all })) };
      })()
    : null;

  const academy = can("report.academy")
    ? await (async () => {
        const courses = await db.academyCourse.findMany({ where: actor.role === "COACH" ? { OR: [{ ownerCoachUserId: actor.userId }, { coaches: { some: { coachUserId: actor.userId } } }] } : {}, select: { title: true, ownerCoach: { select: { email: true } }, _count: { select: { enrollments: true } }, enrollments: { select: { status: true, completion: { select: { examScore: true } } } } } });
        return courses.map((c) => ({ title: c.title, coach: c.ownerCoach.email, enrolled: c._count.enrollments, completed: c.enrollments.filter((e) => e.status === "COMPLETED").length, avgScore: (() => { const s = c.enrollments.map((e) => e.completion?.examScore).filter((x): x is number => typeof x === "number"); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null; })() }));
      })()
    : null;

  const funnel = can("report.pipeline")
    ? await (async () => {
        const [shortlisted, requests, scheduled, selected, deposits, active, placements] = await Promise.all([
          db.shortlistCandidate.count({ where: { addedAt: { gte: since } } }),
          db.interviewRequest.count({ where: { createdAt: { gte: since } } }),
          db.interview.count({ where: { createdAt: { gte: since } } }),
          db.placement.count({ where: { createdAt: { gte: since } } }),
          db.deposit.count({ where: { status: { in: ["PAID", "WAIVED"] }, updatedAt: { gte: since } } }),
          db.placement.count({ where: { activatedAt: { gte: since } } }),
          db.placement.findMany({ where: { activatedAt: { not: null } }, select: { createdAt: true, activatedAt: true } }),
        ]);
        const ttp = placements.map((p) => (p.activatedAt!.getTime() - p.createdAt.getTime()) / 86_400_000);
        return { steps: [{ label: "Shortlisted", value: shortlisted }, { label: "Interview requests", value: requests }, { label: "Interviews", value: scheduled }, { label: "Selected", value: selected }, { label: "Deposit settled", value: deposits }, { label: "Activated", value: active }] as Bar[], avgDaysToPlacement: ttp.length ? Math.round((ttp.reduce((a, b) => a + b, 0) / ttp.length) * 10) / 10 : null, activeNow: await db.placement.count({ where: { status: "ACTIVE" } }) };
      })()
    : null;

  const compliance = can("flag.review")
    ? { openFlags: await db.activityFlag.count({ where: { reviewedAt: null } }), openIncidents: await db.incident.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }), heldMessages: await db.interviewMessage.count({ where: { heldForReview: true, releasedAt: null, blockedAt: null } }) }
    : null;

  return { days, since, talent, available, clients, academy, funnel, compliance };
}
