import type { Prisma, OpportunityStatus, OpportunityVisibility, OpportunitySubmissionStatus as SubmissionStatus, ExperienceLevel } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { agentSelfInclude } from "@/server/repositories/agent.repository";

/** v2 phase 6b: opportunities and submissions. */

export const OPEN_SUBMISSION: SubmissionStatus[] = ["PENDING_REVIEW", "APPROVED_FOR_CLIENT", "INTERVIEWING"];
export const OPEN_MEMBERSHIP = ["ACTIVE", "EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING"] as const;

const submissionInclude = {
  agentProfile: { select: { id: true, userId: true, displayName: true, clientLabel: true, primaryRole: true, status: true, availabilityStatus: true, verificationLevel: true, primaryAgencyId: true, user: { select: { email: true } } } },
  agency: { select: { id: true, name: true, ownerUserId: true, clientFacingCode: true, clientFacingName: true } },
  submittedBy: { select: { id: true, email: true } },
} satisfies Prisma.SubmissionInclude;
export type SubmissionRecord = Prisma.SubmissionGetPayload<{ include: typeof submissionInclude }>;

export const opportunityInclude = {
  client: { select: { id: true, companyName: true, industry: true, country: true, accountManagerUserId: true, contacts: { where: { isPrimary: true }, select: { userId: true, businessEmail: true }, take: 1 } } },
  requirement: { select: { id: true, title: true, status: true } },
  agencies: { select: { agencyId: true, agency: { select: { id: true, name: true, ownerUserId: true } } } },
  submissions: { include: submissionInclude, orderBy: { createdAt: "asc" as const } },
  publishedBy: { select: { id: true, email: true } },
} satisfies Prisma.OpportunityInclude;
export type OpportunityRecord = Prisma.OpportunityGetPayload<{ include: typeof opportunityInclude }>;

export const opportunityRepository = {
  /** Requirements store taxonomy ids or free text; opportunities show names. Unknown values pass through unchanged. */
  async resolveNames(db: Db, skills: string[], software: string[]) {
    const [s, w] = await Promise.all([
      skills.length ? db.skill.findMany({ where: { id: { in: skills } }, select: { id: true, name: true } }) : [],
      software.length ? db.software.findMany({ where: { id: { in: software } }, select: { id: true, name: true } }) : [],
    ]);
    const sm = new Map(s.map((x) => [x.id, x.name]));
    const wm = new Map(w.map((x) => [x.id, x.name]));
    return { skills: skills.map((x) => sm.get(x) ?? x), software: software.map((x) => wm.get(x) ?? x) };
  },

  create(db: Db, d: { requirementId: string; clientId: string; title: string; roleSummary: string; maskedClientLabel: string; skills: string[]; software: string[]; industry: string | null; experienceLevel: ExperienceLevel | null; schedule: string | null; timezone: string | null; startDate: Date | null; headcount: number; visibility: OpportunityVisibility; publishedById: string; agencyIds: string[] }) {
    const { agencyIds, ...rest } = d;
    return db.opportunity.create({ data: { ...rest, agencies: agencyIds.length ? { create: agencyIds.map((agencyId) => ({ agencyId })) } : undefined }, include: opportunityInclude });
  },

  findById(db: Db, id: string) {
    return db.opportunity.findUnique({ where: { id }, include: opportunityInclude });
  },

  findByRequirement(db: Db, requirementId: string) {
    return db.opportunity.findUnique({ where: { requirementId }, include: opportunityInclude });
  },

  setStatus(db: Db, id: string, status: OpportunityStatus, extra: { closedReason?: string | null } = {}) {
    return db.opportunity.update({ where: { id }, data: { status, ...(status === "FILLED" || status === "CLOSED" ? { closedAt: new Date(), closedReason: extra.closedReason ?? null } : {}) }, include: opportunityInclude });
  },

  listForStaff(db: Db, status?: OpportunityStatus, take = 200) {
    return db.opportunity.findMany({ where: status ? { status } : {}, include: opportunityInclude, orderBy: { publishedAt: "desc" }, take });
  },

  listForClient(db: Db, clientId: string) {
    return db.opportunity.findMany({ where: { clientId }, include: opportunityInclude, orderBy: { publishedAt: "desc" } });
  },

  /** Open opportunities an agency may see: shared with everyone or with this agency. */
  listForAgency(db: Db, agencyId: string) {
    return db.opportunity.findMany({ where: { status: { in: ["OPEN", "INTERVIEWING"] }, OR: [{ visibility: "ALL_AGENCIES" }, { visibility: "SELECTED_AGENCIES", agencies: { some: { agencyId } } }] }, include: opportunityInclude, orderBy: { publishedAt: "desc" } });
  },

  /** Open opportunities direct and independent talent may see. */
  listForDirectTalent(db: Db) {
    return db.opportunity.findMany({ where: { status: { in: ["OPEN", "INTERVIEWING"] }, visibility: { in: ["ALL_AGENCIES", "DIRECT_ONLY"] } }, include: opportunityInclude, orderBy: { publishedAt: "desc" } });
  },

  /** Approved members of an agency with the facts eligibility needs. */
  agencyMembersForSubmission(db: Db, agencyId: string) {
    return db.agencyMembership.findMany({
      where: { agencyId, status: { in: [...OPEN_MEMBERSHIP] } },
      select: { status: true, agentProfile: { select: { id: true, displayName: true, primaryRole: true, status: true, availabilityStatus: true, verificationLevel: true, yearsExperience: true, _count: { select: { certifications: { where: { status: "APPROVED" } }, assessments: { where: { status: "FINAL" } } } } } } },
      orderBy: { joinedAt: "asc" },
    });
  },

  profileFacts(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({ where: { id: agentProfileId, deletedAt: null }, select: { id: true, userId: true, displayName: true, status: true, availabilityStatus: true, primaryAgencyId: true, agencyMemberships: { where: { status: { in: [...OPEN_MEMBERSHIP] } }, select: { agencyId: true, status: true } }, _count: { select: { certifications: { where: { status: "APPROVED" } }, assessments: { where: { status: "FINAL" } } } } } });
  },

  openSubmission(db: Db, opportunityId: string, agentProfileId: string) {
    return db.submission.findFirst({ where: { opportunityId, agentProfileId, status: { in: OPEN_SUBMISSION } }, include: submissionInclude });
  },

  countOpenForAgency(db: Db, opportunityId: string, agencyId: string) {
    return db.submission.count({ where: { opportunityId, agencyId, status: { in: OPEN_SUBMISSION } } });
  },

  createSubmission(db: Db, d: { opportunityId: string; agentProfileId: string; agencyId: string | null; submittedById: string; note: string | null }) {
    return db.submission.create({ data: d, include: submissionInclude });
  },

  findSubmission(db: Db, id: string) {
    return db.submission.findUnique({ where: { id }, include: { ...submissionInclude, opportunity: { include: opportunityInclude } } });
  },

  updateSubmission(db: Db, id: string, d: { status?: SubmissionStatus; reviewNote?: string | null; reviewedById?: string | null; reviewedAt?: Date | null; withdrawnReason?: string | null; interviewRequestId?: string | null }) {
    return db.submission.update({ where: { id }, data: d, include: submissionInclude });
  },

  openSubmissionsForAgent(db: Db, agentProfileId: string, agencyId: string) {
    return db.submission.findMany({ where: { agentProfileId, agencyId, status: { in: OPEN_SUBMISSION } }, include: { ...submissionInclude, opportunity: { select: { id: true, title: true, clientId: true, client: { select: { accountManagerUserId: true } } } } } });
  },

  submissionsForAgent(db: Db, agentProfileId: string) {
    return db.submission.findMany({ where: { agentProfileId }, include: { ...submissionInclude, opportunity: { include: opportunityInclude } }, orderBy: { createdAt: "desc" } });
  },

  submissionsForAgency(db: Db, agencyId: string) {
    return db.submission.findMany({ where: { agencyId }, include: { ...submissionInclude, opportunity: { include: opportunityInclude } }, orderBy: { createdAt: "desc" } });
  },

  /** Submissions tied to an interview request, to sync outcomes. */
  submissionsForRequest(db: Db, interviewRequestId: string, agentProfileId: string) {
    return db.submission.findMany({ where: { interviewRequestId, agentProfileId, status: { in: ["INTERVIEWING", "APPROVED_FOR_CLIENT"] } }, include: submissionInclude });
  },

  countPendingReview(db: Db) {
    return db.submission.count({ where: { status: "PENDING_REVIEW" } });
  },

  /** Approved candidates on an opportunity with the full profile include, for client cards. */
  approvedCandidateProfiles(db: Db, opportunityId: string) {
    return db.agentProfile.findMany({ where: { status: "APPROVED", deletedAt: null, submissions: { some: { opportunityId, status: { in: ["APPROVED_FOR_CLIENT", "INTERVIEWING", "SELECTED", "NOT_SELECTED"] } } } }, include: agentSelfInclude() });
  },

  /** Rating inputs for a Partner Team: selected submissions versus placements that reached ACTIVE. */
  async ratingInputs(db: Db, agencyId: string) {
    const [selected, active] = await Promise.all([
      db.submission.count({ where: { agencyId, status: "SELECTED" } }),
      db.placement.count({ where: { agentProfile: { primaryAgencyId: agencyId }, status: { in: ["ACTIVE", "COMPLETED"] } } }),
    ]);
    return { selected, active };
  },
};
