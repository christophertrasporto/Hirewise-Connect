import { z } from "zod";
import { termsForRole, acceptTermsTx, requireTermsAccepted } from "@/server/services/terms.service";
import { guardSignup, ensureIdentity } from "@/server/services/identity.service";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { agencyRepository, type ApplicationWrite } from "@/server/repositories/agency.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getStorage } from "@/server/adapters/storage";
import { rateLimit } from "@/server/auth/rate-limit";
import { assertApplicationTransition, EDITABLE_STATUSES, OPEN_STATUSES, type AgencyApplicationStatus } from "@/server/state/agency-application";
import { toApplicationApplicantView, toApplicationStaffView, toApplicationDocumentView } from "@/server/views/agency.views";
import { getSetting } from "./setting.service";
import { createAgencyForApplication } from "./agency.service";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { emailSchema, requestEmailVerification } from "./auth.service";
import { createSession } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { attachReferrer } from "./referral.service";

/**
 * Apply for Agency (Agency A1). Any non-staff account applies; Hirewise reviewers decide. Approval is the only
 * path (besides a Super Admin's direct creation) that creates an Agency, and it happens inside approveApplication.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const urlOrEmpty = z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal(""));

export const applicationSchema = z.object({
  applicantFullName: z.string().trim().min(2, "Enter your full name.").max(120),
  applicantPhone: optionalText(40),
  proposedAgencyName: z.string().trim().min(2, "Name your agency.").max(120),
  businessRegistration: optionalText(120),
  country: z.string().trim().min(2, "Choose a country.").max(80),
  city: optionalText(80),
  website: urlOrEmpty,
  socialLinks: z.array(z.string().trim().url("Each link must be a full URL.")).max(5).default([]),
  teamSize: z.coerce.number().int().min(0, "Enter your current team size.").max(10000),
  yearsExperience: z.coerce.number().int().min(0).max(60),
  services: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  description: z.string().trim().min(40, "Tell us about your team and why you want to join, in at least 40 characters.").max(4000),
  /** v2 phase 2: the plan the applicant would like; Hirewise confirms it at approval. */
  preferredPlanKey: z.string().trim().max(40).optional().or(z.literal("")),
});
export type ApplicationInput = z.input<typeof applicationSchema>;
type ApplicationParsed = z.infer<typeof applicationSchema>;

export const STAFF_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "SALES", "RECRUITER", "COACH", "OPERATIONS"]);

function toWrite(input: ApplicationParsed, email: string): ApplicationWrite {
  return {
    applicantFullName: input.applicantFullName,
    applicantEmail: email,
    applicantPhone: input.applicantPhone || null,
    proposedAgencyName: input.proposedAgencyName,
    proposedLogoKey: null,
    preferredPlanKey: input.preferredPlanKey || null,
    businessRegistration: input.businessRegistration || null,
    country: input.country,
    city: input.city || null,
    website: input.website || null,
    socialLinks: input.socialLinks,
    teamSize: input.teamSize,
    yearsExperience: input.yearsExperience,
    services: input.services,
    description: input.description,
  };
}

async function documentsOf(db: PrismaClient, applicationId: string) {
  return (await agencyRepository.listDocuments(db, applicationId)).map(toApplicationDocumentView);
}

/** The agreement an applicant must accept, with its text, for the apply form. */
export async function agencyAgreement(db: PrismaClient) {
  const bundle = await termsForRole(db, "AGENCY_OWNER");
  if (!bundle.terms) throw new Error("The Hirewise Connect Terms & Platform Agreement is not published. Ask Hirewise to publish it.");
  return { id: bundle.terms.id, title: bundle.terms.title, version: bundle.terms.version, bodyMarkdown: bundle.terms.sections.map((s) => `## ${s.number}. ${s.title}\n\n${s.bodyMarkdown}`).join("\n\n"), checkboxLabel: bundle.checkboxLabel, bundle };
}

/** Whether this actor may apply right now, and if not, why. Used by the apply page and by submitApplication. */
export async function applicationEligibility(db: PrismaClient, actor: Actor): Promise<{ canApply: boolean; reason: string | null; reapplyAfter: Date | null; latest: Awaited<ReturnType<typeof myApplication>> }> {
  const latest = await myApplication(db, actor);
  if (STAFF_ROLES.has(actor.role)) return { canApply: false, reason: "Hirewise staff accounts cannot apply to run an agency.", reapplyAfter: null, latest };
  if (actor.agency) return { canApply: false, reason: "You already belong to an agency.", reapplyAfter: null, latest };
  if (latest && (OPEN_STATUSES as readonly string[]).includes(latest.status)) return { canApply: false, reason: "You already have an application in progress.", reapplyAfter: null, latest };
  if (latest?.status === "APPROVED") return { canApply: false, reason: "Your application was approved.", reapplyAfter: null, latest };
  if (latest?.status === "REJECTED" && latest.reapplyAfter && latest.reapplyAfter.getTime() > Date.now()) return { canApply: false, reason: `You can apply again after ${latest.reapplyAfter.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`, reapplyAfter: latest.reapplyAfter, latest };
  return { canApply: true, reason: null, reapplyAfter: null, latest };
}

export async function submitApplication(db: PrismaClient, actor: Actor, raw: ApplicationInput & { agreementAccepted: boolean }, meta: RequestMeta) {
  const e = await applicationEligibility(db, actor);
  if (!e.canApply) throw new ForbiddenError(e.reason ?? "You cannot apply right now.");
  const input = applicationSchema.parse(raw);
  if (!raw.agreementAccepted) throw Object.assign(new Error("Accept the Hirewise Connect Terms & Platform Agreement to apply."), { name: "UploadRejectedError", field: "agreementAccepted" });
  const flags = await userRepository.authFlags(db, actor.userId);
  if (!flags) throw new NotFoundError();
  rateLimit(`agency-apply:${actor.userId}`, 5, 24 * 60 * 60_000);
  return db.$transaction(async (tx) => {
    const app = await agencyRepository.createApplication(tx, actor.userId, toWrite(input, flags.email));
    // Identity phase 1: the unified terms are accepted again in the application context (one checkbox, same document).
    const accepted = await acceptTermsTx(tx, { userId: actor.userId, role: actor.role, agencyId: null, context: "AGENCY_APPLICATION", applicationId: app.id, meta, actor });
    await agencyRepository.updateApplication(tx, app.id, { agreementAcceptanceId: accepted.termsAcceptanceId });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: null, newStatus: "SUBMITTED", changedById: actor.userId, notes: null });
    await audit(tx, { actor, action: "AGENCY_AGREEMENT_ACCEPTED", entityType: "Agreement", entityId: accepted.termsAgreementId, newValue: { type: "PLATFORM_TERMS", version: accepted.termsVersion, applicationId: app.id }, ipAddress: meta.ipAddress ?? undefined });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_SUBMITTED", entityType: "AgencyApplication", entityId: app.id, newValue: { proposedAgencyName: input.proposedAgencyName, country: input.country, teamSize: input.teamSize }, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "AGENCY_APPLICATION_SUBMITTED", { applicationId: app.id, applicantUserId: actor.userId, applicantName: input.applicantFullName, agencyName: input.proposedAgencyName, resubmission: false });
    return app.id;
  });
}

/** The applicant's latest application (any status), or null. */
export async function myApplication(db: PrismaClient, actor: Actor) {
  const app = await agencyRepository.latestForUser(db, actor.userId);
  if (!app) return null;
  return toApplicationApplicantView(app, await documentsOf(db, app.id));
}

async function ownEditable(db: PrismaClient, actor: Actor, applicationId: string) {
  const app = await agencyRepository.findApplication(db, applicationId);
  if (!app || app.applicantUserId !== actor.userId) throw new NotFoundError();
  if (!(EDITABLE_STATUSES as readonly string[]).includes(app.status)) throw new ForbiddenError("This application can no longer be edited.");
  return app;
}

/** Edit while SUBMITTED (not yet picked up) or NEEDS_MORE_INFO. */
export async function updateApplication(db: PrismaClient, actor: Actor, applicationId: string, raw: ApplicationInput) {
  const app = await ownEditable(db, actor, applicationId);
  const input = applicationSchema.parse(raw);
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { ...toWrite(input, app.applicantEmail), proposedLogoKey: app.proposedLogoKey });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_UPDATED", entityType: "AgencyApplication", entityId: app.id, newValue: { proposedAgencyName: input.proposedAgencyName } });
  });
}

/** NEEDS_MORE_INFO → SUBMITTED, after the applicant has answered. */
export async function resubmitApplication(db: PrismaClient, actor: Actor, applicationId: string) {
  const app = await agencyRepository.findApplication(db, applicationId);
  if (!app || app.applicantUserId !== actor.userId) throw new NotFoundError();
  assertApplicationTransition(actor, app.applicantUserId, app.status, "SUBMITTED");
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { status: "SUBMITTED", resubmittedAt: new Date(), applicantVisibleMessage: null });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "SUBMITTED", changedById: actor.userId, notes: "Resubmitted by the applicant" });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_SUBMITTED", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status }, newValue: { status: "SUBMITTED", resubmission: true } });
    await publishEvent(tx, "AGENCY_APPLICATION_SUBMITTED", { applicationId: app.id, applicantUserId: actor.userId, applicantName: app.applicantFullName, agencyName: app.proposedAgencyName, resubmission: true });
  });
}

export async function withdrawApplication(db: PrismaClient, actor: Actor, applicationId: string) {
  const app = await agencyRepository.findApplication(db, applicationId);
  if (!app || app.applicantUserId !== actor.userId) throw new NotFoundError();
  assertApplicationTransition(actor, app.applicantUserId, app.status, "WITHDRAWN");
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { status: "WITHDRAWN" });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "WITHDRAWN", changedById: actor.userId, notes: null });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_WITHDRAWN", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status } });
  });
}

// ---------------------------------------------------------------------------
// Supporting documents (applicant uploads while editable; reviewers read)
// ---------------------------------------------------------------------------

export const APPLICATION_DOCUMENT_MIMES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
export const documentUploadRequestSchema = z.object({ contentType: z.string().min(1), sizeBytes: z.coerce.number().int().positive(), fileName: z.string().trim().min(1).max(160) });
const docPrefix = (applicationId: string) => `agency-applications/${applicationId}/`;

export async function createApplicationUploadUrl(db: PrismaClient, actor: Actor, applicationId: string, raw: z.input<typeof documentUploadRequestSchema>) {
  const app = await ownEditable(db, actor, applicationId);
  const input = documentUploadRequestSchema.parse(raw);
  const rules = await getSetting(db, "agencyApplications");
  const existing = await agencyRepository.listDocuments(db, app.id);
  if (existing.length >= rules.maxDocuments) throw new Error(`You can attach up to ${rules.maxDocuments} documents.`);
  const ext = APPLICATION_DOCUMENT_MIMES[input.contentType];
  if (!ext) throw new Error("Upload a PDF, Word document, or image.");
  if (input.sizeBytes > rules.maxDocumentBytes) throw new Error(`Each document can be at most ${Math.round(rules.maxDocumentBytes / 1024 / 1024)} MB.`);
  rateLimit(`agency-doc:${actor.userId}`, 30, 60 * 60_000);
  const safe = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `document.${ext}`;
  const key = `${docPrefix(app.id)}${randomUUID()}__${safe}`;
  const upload = await getStorage().createUploadUrl(key, input.contentType);
  return { key, ...upload };
}

export async function attachApplicationDocument(db: PrismaClient, actor: Actor, applicationId: string, storageKey: string) {
  const app = await ownEditable(db, actor, applicationId);
  if (!storageKey.startsWith(docPrefix(app.id))) throw new ForbiddenError("Storage key does not belong to this application");
  if (!(await getStorage().exists(storageKey))) throw new Error("The file was not uploaded. Try again.");
  return db.$transaction(async (tx) => {
    const doc = await agencyRepository.addDocument(tx, { applicationId: app.id, kind: "SUPPORTING_DOCUMENT", storageKey, uploadedById: actor.userId });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_UPDATED", entityType: "AgencyApplication", entityId: app.id, newValue: { document: doc.id, op: "attach" } });
    return doc.id;
  });
}

export async function removeApplicationDocument(db: PrismaClient, actor: Actor, applicationId: string, documentId: string) {
  const app = await ownEditable(db, actor, applicationId);
  const doc = await agencyRepository.findDocument(db, documentId);
  if (!doc || doc.ownerType !== "AGENCY_APPLICATION" || doc.ownerId !== app.id) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await agencyRepository.deleteDocument(tx, doc.id);
    await audit(tx, { actor, action: "AGENCY_APPLICATION_UPDATED", entityType: "AgencyApplication", entityId: app.id, newValue: { document: doc.id, op: "remove" } });
  });
}

/** Signed URL for a document: the applicant, or staff who may read agencies. */
export async function applicationDocumentUrl(db: PrismaClient, actor: Actor, documentId: string): Promise<string> {
  const doc = await agencyRepository.findDocument(db, documentId);
  if (!doc || doc.ownerType !== "AGENCY_APPLICATION") throw new NotFoundError();
  const app = await agencyRepository.findApplication(db, doc.ownerId);
  if (!app) throw new NotFoundError();
  if (app.applicantUserId !== actor.userId && !actor.permissions.has("agency.read") && !actor.permissions.has("agency.review")) throw new NotFoundError();
  return getStorage().createDownloadUrl(doc.storageKey);
}

// ---------------------------------------------------------------------------
// Hirewise review
// ---------------------------------------------------------------------------

export type ApplicationFilters = { status?: AgencyApplicationStatus | ""; country?: string; from?: string; to?: string; q?: string };

export async function listApplications(db: PrismaClient, actor: Actor, f: ApplicationFilters = {}) {
  if (!actor.permissions.has("agency.review")) authorize(actor, "agency.read");
  const rows = await agencyRepository.listApplications(db, { status: f.status || undefined, country: f.country || undefined, from: f.from ? new Date(f.from) : undefined, to: f.to ? new Date(`${f.to}T23:59:59.999Z`) : undefined, q: f.q || undefined });
  const { counts, avgReviewHours } = await agencyRepository.applicationCounts(db);
  return { rows: rows.map((a) => ({ id: a.id, status: a.status, proposedAgencyName: a.proposedAgencyName, applicantFullName: a.applicantFullName, applicantEmail: a.applicantEmail, country: a.country, city: a.city, teamSize: a.teamSize, submittedAt: a.submittedAt, resubmittedAt: a.resubmittedAt, reviewedAt: a.reviewedAt, reviewer: a.reviewer ? a.reviewer.email.split("@")[0] : null })), counts, avgReviewHours };
}

export async function getApplication(db: PrismaClient, actor: Actor, applicationId: string) {
  if (!actor.permissions.has("agency.review")) authorize(actor, "agency.read");
  const app = await agencyRepository.findApplication(db, applicationId);
  if (!app) throw new NotFoundError();
  return toApplicationStaffView(app, await documentsOf(db, app.id));
}

async function forReview(db: PrismaClient, actor: Actor, applicationId: string) {
  authorize(actor, "agency.review");
  const app = await agencyRepository.findApplication(db, applicationId);
  if (!app) throw new NotFoundError();
  return app;
}

/** SUBMITTED → UNDER_REVIEW; the reviewer takes ownership. Internal notes may be added at any time. */
export async function startReview(db: PrismaClient, actor: Actor, applicationId: string, notes?: string) {
  const app = await forReview(db, actor, applicationId);
  assertApplicationTransition(actor, app.applicantUserId, app.status, "UNDER_REVIEW");
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { status: "UNDER_REVIEW", reviewerId: actor.userId, ...(notes ? { reviewNotes: notes } : {}) });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "UNDER_REVIEW", changedById: actor.userId, notes: notes || null });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_REVIEW_STARTED", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status }, newValue: { status: "UNDER_REVIEW" } });
  });
}

export async function saveReviewNotes(db: PrismaClient, actor: Actor, applicationId: string, notes: string) {
  const app = await forReview(db, actor, applicationId);
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { reviewNotes: notes.trim() || null });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_UPDATED", entityType: "AgencyApplication", entityId: app.id, newValue: { op: "review-notes" } });
  });
}

export const decisionSchema = z.object({ message: z.string().trim().max(4000).optional().or(z.literal("")), notes: z.string().trim().max(4000).optional().or(z.literal("")), reapplyAfterDays: z.coerce.number().int().min(0).max(3650).optional().or(z.literal("")) });

export async function requestMoreInfo(db: PrismaClient, actor: Actor, applicationId: string, raw: z.input<typeof decisionSchema>) {
  const app = await forReview(db, actor, applicationId);
  const input = decisionSchema.parse(raw);
  if (!input.message) throw Object.assign(new Error("Tell the applicant what you need."), { name: "UploadRejectedError", field: "message" });
  assertApplicationTransition(actor, app.applicantUserId, app.status, "NEEDS_MORE_INFO", input.message);
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { status: "NEEDS_MORE_INFO", reviewerId: actor.userId, applicantVisibleMessage: input.message!, ...(input.notes ? { reviewNotes: input.notes } : {}) });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "NEEDS_MORE_INFO", changedById: actor.userId, notes: input.message! });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_INFO_REQUESTED", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status }, newValue: { status: "NEEDS_MORE_INFO" }, reason: input.message });
    await publishEvent(tx, "AGENCY_APPLICATION_DECIDED", { applicationId: app.id, applicantUserId: app.applicantUserId, applicantEmail: app.applicantEmail, agencyName: app.proposedAgencyName, status: "NEEDS_MORE_INFO", message: input.message!, agencyId: null });
  });
}

/** Reject with a required reason; the applicant may apply again after the configured cooldown (overridable here). */
export async function rejectApplication(db: PrismaClient, actor: Actor, applicationId: string, raw: z.input<typeof decisionSchema>) {
  const app = await forReview(db, actor, applicationId);
  const input = decisionSchema.parse(raw);
  if (!input.message) throw Object.assign(new Error("A reason is required to reject an application."), { name: "UploadRejectedError", field: "message" });
  assertApplicationTransition(actor, app.applicantUserId, app.status, "REJECTED", input.message);
  const rules = await getSetting(db, "agencyApplications");
  const days = input.reapplyAfterDays === "" || input.reapplyAfterDays === undefined ? rules.reapplyCooldownDays : input.reapplyAfterDays;
  const reapplyAfter = new Date(Date.now() + days * 24 * 60 * 60_000);
  await db.$transaction(async (tx) => {
    await agencyRepository.updateApplication(tx, app.id, { status: "REJECTED", reviewerId: actor.userId, rejectionReason: input.message!, reapplyAfter, reviewedAt: new Date(), ...(input.notes ? { reviewNotes: input.notes } : {}) });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "REJECTED", changedById: actor.userId, notes: input.message! });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_REJECTED", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status }, newValue: { status: "REJECTED", reapplyAfter: reapplyAfter.toISOString(), cooldownDays: days }, reason: input.message });
    await publishEvent(tx, "AGENCY_APPLICATION_DECIDED", { applicationId: app.id, applicantUserId: app.applicantUserId, applicantEmail: app.applicantEmail, agencyName: app.proposedAgencyName, status: "REJECTED", message: input.message!, agencyId: null });
  });
}

/**
 * Approve: the Agency is created from the application, the applicant gets the Owner seat (and the Agency Owner
 * role when they had no other role), and, if they have a talent profile, a primary membership of their own agency.
 */
export async function approveApplication(db: PrismaClient, actor: Actor, applicationId: string, raw: z.input<typeof decisionSchema> = {}) {
  const app = await forReview(db, actor, applicationId);
  const input = decisionSchema.parse(raw);
  assertApplicationTransition(actor, app.applicantUserId, app.status, "APPROVED");
  if (app.applicant.agentProfiles.length === 0 && app.applicant.role.key !== "APPLICANT" && app.applicant.role.key !== "CLIENT") {
    // Staff accounts never become agency owners.
    if (STAFF_ROLES.has(app.applicant.role.key)) throw new ForbiddenError("A Hirewise staff account cannot own an agency.");
  }
  return db.$transaction(async (tx) => {
    const agencyId = await createAgencyForApplication(tx, actor, app);
    await agencyRepository.updateApplication(tx, app.id, { status: "APPROVED", reviewerId: actor.userId, reviewedAt: new Date(), createdAgencyId: agencyId, applicantVisibleMessage: input.message || null, ...(input.notes ? { reviewNotes: input.notes } : {}) });
    await agencyRepository.addHistory(tx, { applicationId: app.id, previousStatus: app.status, newStatus: "APPROVED", changedById: actor.userId, notes: input.notes || null });
    await audit(tx, { actor, action: "AGENCY_APPLICATION_APPROVED", entityType: "AgencyApplication", entityId: app.id, previousValue: { status: app.status }, newValue: { status: "APPROVED", agencyId }, reason: input.notes || undefined });
    await publishEvent(tx, "AGENCY_APPLICATION_DECIDED", { applicationId: app.id, applicantUserId: app.applicantUserId, applicantEmail: app.applicantEmail, agencyName: app.proposedAgencyName, status: "APPROVED", message: input.message || null, agencyId });
    return agencyId;
  });
}

// ---------------------------------------------------------------------------
// Public sign-up for people who are neither talent nor clients (decision D2)
// ---------------------------------------------------------------------------

export const applicantRegistrationSchema = z.object({
  termsAccepted: z.boolean().default(false),
  continuationToken: z.string().trim().optional().or(z.literal("")), fullName: z.string().trim().min(2, "Enter your full name.").max(120), email: emailSchema, password: passwordSchema });
export type ApplicantRegistrationInput = z.infer<typeof applicantRegistrationSchema>;

/** Creates an APPLICANT account (no permissions), a session, and the email-verification gate, exactly like talent registration. */
export async function registerApplicant(db: PrismaClient, input: ApplicantRegistrationInput, meta: RequestMeta, opts: { referralCode?: string | null } = {}) {
  rateLimit(`register:${meta.ipAddress ?? "unknown"}`, 10, 60 * 60_000);
  requireTermsAccepted(input.termsAccepted);
  await guardSignup(db, { kind: "AGENCY_APPLICATION", email: input.email, fullName: input.fullName, data: { fullName: input.fullName }, continuationToken: input.continuationToken || null, meta });
  const passwordHash = await hashPassword(input.password);
  const role = await userRepository.roleIdByKey(db, "APPLICANT");
  const userId = await db.$transaction(async (tx) => {
    const user = await userRepository.create(tx, { email: input.email, passwordHash, roleId: role.id });
    const actor: Actor = { userId: user.id, role: "APPLICANT", permissions: new Set() };
    await audit(tx, { actor, action: "USER_CREATED", entityType: "User", entityId: user.id, newValue: { role: "APPLICANT", fullName: input.fullName }, ipAddress: meta.ipAddress ?? undefined });
    await ensureIdentity(tx, actor, { userId: user.id, email: input.email });
    await acceptTermsTx(tx, { userId: user.id, role: "APPLICANT", context: "SIGNUP", meta, actor });
    await attachReferrer(tx, { userId: user.id, email: input.email, code: opts.referralCode, meta });
    await publishEvent(tx, "USER_CREATED", { userId: user.id, role: "APPLICANT", email: input.email });
    return user.id;
  });
  try {
    await requestEmailVerification(db, { userId, email: input.email, ...meta });
  } catch (err) {
    logger.error({ userId, err: err instanceof Error ? { name: err.name, message: err.message } : err }, "applicant registration: verification email could not be delivered");
  }
  const session = await createSession(db, { userId, mfaPassed: true, remember: true, ...meta });
  return { userId, ...session };
}
