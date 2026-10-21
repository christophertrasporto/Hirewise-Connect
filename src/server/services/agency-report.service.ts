import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { scopedAgencyId } from "@/server/policies/ownership";
import { agencyReportRepository } from "@/server/repositories/agency-report.repository";

/** Agency Reports tab (v2 phase 6b). Every number is bounded by the agency id; staff may read any agency's report. */
export async function agencyReport(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.reports.read");
  const [team, training, submissions, interviews, placements] = await Promise.all([
    agencyReportRepository.team(db, agencyId),
    agencyReportRepository.training(db, agencyId),
    agencyReportRepository.submissions(db, agencyId),
    agencyReportRepository.interviews(db, agencyId),
    agencyReportRepository.placements(db, agencyId),
  ]);
  const count = (xs: Array<{ status: string }>, s: string) => xs.filter((x) => x.status === s).length;
  const approved = team.filter((m) => m.status === "APPROVED");
  const years = approved.map((m) => m.yearsExperience).filter((y): y is number => y !== null);
  return {
    team: {
      total: team.length,
      approved: approved.length,
      inReview: count(team, "SUBMITTED") + count(team, "UNDER_REVIEW"),
      draft: count(team, "DRAFT") + count(team, "REVISION_REQUIRED"),
      available: approved.filter((m) => m.availabilityStatus === "AVAILABLE" || m.availabilityStatus === "AVAILABLE_SOON").length,
      interviewing: approved.filter((m) => m.availabilityStatus === "INTERVIEWING" || m.availabilityStatus === "RESERVED").length,
      placed: approved.filter((m) => m.availabilityStatus === "PLACED").length,
      certified: approved.filter((m) => m._count.certifications > 0).length,
      assessed: approved.filter((m) => m._count.assessments > 0).length,
      avgYearsExperience: years.length ? Math.round((years.reduce((a, b) => a + b, 0) / years.length) * 10) / 10 : null,
      byVerification: Object.entries(approved.reduce((acc, m) => ({ ...acc, [m.verificationLevel]: (acc[m.verificationLevel] ?? 0) + 1 }), {} as Record<string, number>)).map(([level, n]) => ({ level, n })),
    },
    training: {
      enrolled: (training.enrollments.ENROLLED ?? 0) + (training.enrollments.IN_PROGRESS ?? 0),
      completed: training.enrollments.COMPLETED ?? 0,
      dropped: training.enrollments.DROPPED ?? 0,
      completionPct: (() => {
        const total = Object.values(training.enrollments).reduce((a, b) => a + b, 0);
        return total ? Math.round(((training.enrollments.COMPLETED ?? 0) / total) * 100) : null;
      })(),
      seatsPurchased: training.seatsPurchased,
    },
    submissions: {
      pending: submissions.PENDING_REVIEW ?? 0,
      approved: submissions.APPROVED_FOR_CLIENT ?? 0,
      interviewing: submissions.INTERVIEWING ?? 0,
      selected: submissions.SELECTED ?? 0,
      notSelected: submissions.NOT_SELECTED ?? 0,
      declined: submissions.DECLINED ?? 0,
      withdrawn: submissions.WITHDRAWN ?? 0,
      total: Object.values(submissions).reduce((a, b) => a + b, 0),
    },
    interviews,
    placements: {
      active: placements.ACTIVE ?? 0,
      inPipeline: (placements.SELECTED ?? 0) + (placements.AWAITING_AGREEMENT ?? 0) + (placements.AWAITING_DEPOSIT ?? 0) + (placements.DEPLOYMENT_PREP ?? 0),
      paused: placements.PAUSED ?? 0,
      completed: placements.COMPLETED ?? 0,
      cancelled: placements.CANCELLED ?? 0,
      total: Object.values(placements).reduce((a, b) => a + b, 0),
    },
  };
}
export type AgencyReport = Awaited<ReturnType<typeof agencyReport>>;
