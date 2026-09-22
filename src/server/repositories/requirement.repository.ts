import type { ExperienceLevel, RequirementStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type RequirementCreate = {
  clientId: string;
  title: string;
  role: string;
  jobDescription: string | null;
  skills: string[];
  industry: string | null;
  experienceLevel: ExperienceLevel | null;
  agentsRequired: number;
  schedule: string | null;
  timezone: string | null;
  software: string[];
  startDate: Date | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  otherRequirements: string | null;
};

export const requirementRepository = {
  create(db: Db, d: RequirementCreate) {
    return db.clientRequirement.create({
      data: {
        ...d,
        jobDescription: d.jobDescription ?? undefined,
        industry: d.industry ?? undefined,
        experienceLevel: d.experienceLevel ?? undefined,
        schedule: d.schedule ?? undefined,
        timezone: d.timezone ?? undefined,
        startDate: d.startDate ?? undefined,
        budgetMin: d.budgetMin ?? undefined,
        budgetMax: d.budgetMax ?? undefined,
        currency: d.currency ?? undefined,
        otherRequirements: d.otherRequirements ?? undefined,
      },
    });
  },

  findById(db: Db, id: string) {
    return db.clientRequirement.findUnique({ where: { id }, include: { client: { select: { id: true, companyName: true, accountManagerUserId: true } } } });
  },

  listForClient(db: Db, clientId: string) {
    return db.clientRequirement.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
  },

  listForStaff(db: Db, status?: RequirementStatus, take = 100) {
    return db.clientRequirement.findMany({ where: status ? { status } : {}, include: { client: { select: { id: true, companyName: true, accountManagerUserId: true } } }, orderBy: { createdAt: "desc" }, take });
  },

  setStatus(db: Db, id: string, status: RequirementStatus) {
    return db.clientRequirement.update({ where: { id }, data: { status } });
  },

  countOpen(db: Db) {
    return db.clientRequirement.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } });
  },
};
