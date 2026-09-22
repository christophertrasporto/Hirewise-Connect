import type { AgentProfileStatus, AvailabilityStatus, ExperienceLevel, SkillLevel, VerificationLevel, WorkSetup } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type SearchWhere = {
  text?: string;
  role?: string;
  skillIds?: string[];
  softwareIds?: string[];
  industry?: string;
  experienceLevels?: ExperienceLevel[];
  availability?: AvailabilityStatus[];
  workSetup?: WorkSetup;
  languages?: string[];
  /** Levels at or above the requested minimum. */
  minVerification?: VerificationLevel[];
  campaignOnly?: boolean;
  certificationTemplateIds?: string[];
  courseIds?: string[];
  minAssessmentRank?: number;
};

/** Everything the agent's own dashboard and wizard need. Private contact included; strip in views. */
export function agentSelfInclude() {
  return {
    privateContact: true,
    skills: { include: { skill: true } },
    experiences: { orderBy: { startDate: "desc" as const } },
    industryExperiences: true,
    softwareExperiences: { include: { software: true } },
    videos: { orderBy: { createdAt: "desc" as const } },
    recordings: { orderBy: { createdAt: "desc" as const } },
    portfolioItems: { orderBy: { createdAt: "desc" as const } },
    certifications: { include: { template: { select: { id: true, name: true, badgeKey: true, clientVisibleScores: true } }, assessment: { select: { examScore: true, practicalScore: true, roleplayScore: true, communicationScore: true, resultLabel: { select: { label: true, rank: true } } } } }, orderBy: { issuedAt: "desc" as const } },
    assessments: { where: { status: "FINAL" as const }, include: { resultLabel: true, course: { select: { title: true } } }, orderBy: { assessedAt: "desc" as const } },
    coachEvaluations: { include: { overallLabel: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
    enrollments: { include: { course: { select: { id: true, title: true, category: true } }, completion: true }, orderBy: { enrolledAt: "desc" as const } },
  } as const;
}

export const agentRepository = {
  createForUser(db: Db, d: { userId: string; displayName: string; fullLegalName: string; personalEmail: string; phone: string | null; locationCity: string | null; locationCountry: string | null; timezone: string | null; primaryRole: string | null; yearsExperience: number | null }) {
    return db.agentProfile.create({
      data: {
        userId: d.userId,
        displayName: d.displayName,
        locationCity: d.locationCity ?? undefined,
        locationCountry: d.locationCountry ?? undefined,
        timezone: d.timezone ?? undefined,
        primaryRole: d.primaryRole ?? undefined,
        yearsExperience: d.yearsExperience ?? undefined,
        status: "DRAFT",
        availabilityStatus: "UNAVAILABLE",
        privateContact: { create: { fullLegalName: d.fullLegalName, personalEmail: d.personalEmail, phone: d.phone ?? undefined } },
      },
    });
  },

  findSelf(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({ where: { id: agentProfileId, deletedAt: null }, include: agentSelfInclude() });
  },

  findByIdForStaff(db: Db, id: string) {
    return db.agentProfile.findUnique({ where: { id, deletedAt: null }, include: { ...agentSelfInclude(), user: { select: { email: true, status: true } } } });
  },

  updatePersonal(db: Db, id: string, d: { displayName: string; locationCity: string | null; locationCountry: string | null; timezone: string | null; languages: string[]; workSetup: WorkSetup | null; preferredShift: string | null; equipmentSummary: string | null; internetSummary: string | null }, priv: { fullLegalName: string; phone: string | null; addressLine: string | null }) {
    return db.agentProfile.update({
      where: { id },
      data: {
        displayName: d.displayName,
        locationCity: d.locationCity,
        locationCountry: d.locationCountry,
        timezone: d.timezone,
        languages: d.languages,
        workSetup: d.workSetup,
        preferredShift: d.preferredShift,
        equipmentSummary: d.equipmentSummary,
        internetSummary: d.internetSummary,
        privateContact: { upsert: { create: { fullLegalName: priv.fullLegalName, phone: priv.phone ?? undefined, addressLine: priv.addressLine ?? undefined }, update: { fullLegalName: priv.fullLegalName, phone: priv.phone, addressLine: priv.addressLine } } },
      },
    });
  },

  updateProfessional(db: Db, id: string, d: { headline: string | null; primaryRole: string | null; summary: string | null; yearsExperience: number | null; experienceLevel: ExperienceLevel | null }) {
    return db.agentProfile.update({ where: { id }, data: d });
  },

  async replaceSkills(db: Db, id: string, skills: Array<{ skillId: string; level: SkillLevel; yearsUsed: number | null }>) {
    await db.agentSkill.deleteMany({ where: { agentProfileId: id } });
    if (skills.length) await db.agentSkill.createMany({ data: skills.map((s) => ({ agentProfileId: id, skillId: s.skillId, level: s.level, yearsUsed: s.yearsUsed ?? undefined })) });
  },

  async replaceSoftware(db: Db, id: string, items: Array<{ softwareId: string; level: SkillLevel }>) {
    await db.softwareExperience.deleteMany({ where: { agentProfileId: id } });
    if (items.length) await db.softwareExperience.createMany({ data: items.map((s) => ({ agentProfileId: id, softwareId: s.softwareId, level: s.level })) });
  },

  async replaceIndustries(db: Db, id: string, items: Array<{ industry: string; years: number }>) {
    await db.industryExperience.deleteMany({ where: { agentProfileId: id } });
    if (items.length) await db.industryExperience.createMany({ data: items.map((s) => ({ agentProfileId: id, industry: s.industry, years: s.years })) });
  },

  async setAvailability(db: Db, id: string, status: AvailabilityStatus, meta: { setById: string | null; reason?: string; availableFrom?: Date | null }) {
    await db.agentProfile.update({ where: { id }, data: { availabilityStatus: status, availableFrom: meta.availableFrom ?? undefined } });
    await db.agentAvailability.create({ data: { agentProfileId: id, status, reason: meta.reason, setById: meta.setById ?? undefined, availableFrom: meta.availableFrom ?? undefined } });
  },

  addExperience(db: Db, id: string, d: { company: string | null; title: string; industry: string | null; startDate: Date; endDate: Date | null; description: string | null; isCampaign: boolean; campaignType: string | null }) {
    return db.experience.create({ data: { agentProfileId: id, ...d, company: d.company ?? undefined, industry: d.industry ?? undefined, endDate: d.endDate ?? undefined, description: d.description ?? undefined, campaignType: d.campaignType ?? undefined } });
  },

  removeExperience(db: Db, agentProfileId: string, experienceId: string) {
    // Scoped by agentProfileId so an agent cannot delete another agent's row by id.
    return db.experience.deleteMany({ where: { id: experienceId, agentProfileId } });
  },

  setPhotoKey(db: Db, id: string, photoKey: string) {
    return db.agentProfile.update({ where: { id }, data: { photoKey } });
  },

  setResumeKey(db: Db, id: string, resumeKey: string) {
    return db.agentPrivateContact.update({ where: { agentProfileId: id }, data: { resumeKey } });
  },

  setCompletion(db: Db, id: string, profileCompletion: number) {
    return db.agentProfile.update({ where: { id }, data: { profileCompletion } });
  },

  setVerification(db: Db, id: string, level: VerificationLevel, isManual: boolean) {
    return db.agentProfile.update({ where: { id }, data: { verificationLevel: level, verificationIsManual: isManual } });
  },

  setStatus(db: Db, id: string, status: AgentProfileStatus, extra: { submittedAt?: Date; approvedAt?: Date; approvedById?: string; hiddenAt?: Date | null; suspendedAt?: Date | null } = {}) {
    return db.agentProfile.update({ where: { id }, data: { status, ...extra } });
  },

  listByStatus(db: Db, status: AgentProfileStatus | undefined, take = 100) {
    return db.agentProfile.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      include: { user: { select: { email: true } }, skills: { include: { skill: true } } },
      orderBy: { submittedAt: "desc" },
      take,
    });
  },

  /** Client-visible candidates: APPROVED only (Section 5.1), with optional SQL-level filters. */
  searchApproved(db: Db, f: SearchWhere, take = 200) {
    return db.agentProfile.findMany({
      where: {
        deletedAt: null,
        status: "APPROVED",
        ...(f.availability?.length ? { availabilityStatus: { in: f.availability } } : { availabilityStatus: { not: "UNAVAILABLE" } }),
        ...(f.role ? { primaryRole: { equals: f.role, mode: "insensitive" } } : {}),
        ...(f.experienceLevels?.length ? { experienceLevel: { in: f.experienceLevels } } : {}),
        ...(f.workSetup ? { workSetup: f.workSetup } : {}),
        ...(f.languages?.length ? { languages: { hasEvery: f.languages } } : {}),
        ...(f.minVerification ? { verificationLevel: { in: f.minVerification } } : {}),
        ...(f.skillIds?.length ? { AND: f.skillIds.map((skillId) => ({ skills: { some: { skillId } } })) } : {}),
        ...(f.softwareIds?.length ? { softwareExperiences: { some: { softwareId: { in: f.softwareIds } } } } : {}),
        ...(f.industry ? { industryExperiences: { some: { industry: { equals: f.industry, mode: "insensitive" } } } } : {}),
        ...(f.campaignOnly ? { experiences: { some: { isCampaign: true } } } : {}),
        ...(f.certificationTemplateIds?.length ? { AND: f.certificationTemplateIds.map((templateId) => ({ certifications: { some: { templateId, status: "APPROVED" } } })) } : {}),
        ...(f.courseIds?.length ? { enrollments: { some: { courseId: { in: f.courseIds }, status: "COMPLETED" } } } : {}),
        ...(f.minAssessmentRank ? { assessments: { some: { status: "FINAL", resultLabel: { rank: { gte: f.minAssessmentRank } } } } } : {}),
        ...(f.text ? { OR: [{ headline: { contains: f.text, mode: "insensitive" } }, { summary: { contains: f.text, mode: "insensitive" } }, { displayName: { contains: f.text, mode: "insensitive" } }] } : {}),
      },
      include: agentSelfInclude(),
      orderBy: [{ approvedAt: "desc" }],
      take,
    });
  },

  findApprovedById(db: Db, id: string) {
    return db.agentProfile.findFirst({ where: { id, status: "APPROVED", deletedAt: null }, include: agentSelfInclude() });
  },

  findManyApproved(db: Db, ids: string[]) {
    return db.agentProfile.findMany({ where: { id: { in: ids }, status: "APPROVED", deletedAt: null }, include: agentSelfInclude() });
  },

  countByStatus(db: Db) {
    return db.agentProfile.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } });
  },

  async availabilityOf(db: Db, id: string) {
    const p = await db.agentProfile.findUnique({ where: { id }, select: { availabilityStatus: true } });
    return p?.availabilityStatus ?? null;
  },

  countAvailable(db: Db) {
    return db.agentProfile.count({ where: { status: "APPROVED", availabilityStatus: { in: ["AVAILABLE", "AVAILABLE_SOON"] }, deletedAt: null } });
  },
};
