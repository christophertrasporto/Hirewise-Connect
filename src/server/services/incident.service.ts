import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getStorage, newStorageKey } from "@/server/adapters/storage";

/**
 * Section 8.8 incident management: Admin (incident.read/write) creates incidents, attaches
 * evidence documents, suspends the subject user with a reason, and resolves. Sales may create
 * incidents and see only those they reported (Section 6, footnote 11).
 */

export const incidentSchema = z.object({
  subjectUserId: z.string().min(1),
  type: z.enum(["RATE_DISCUSSION", "OFF_PLATFORM_CONTACT", "DIRECT_HIRE_ATTEMPT", "POLICY_VIOLATION", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  description: z.string().trim().min(10, "Describe what happened.").max(4000),
  relatedType: z.string().trim().max(60).optional().or(z.literal("")),
  relatedId: z.string().trim().max(60).optional().or(z.literal("")),
});

const incidentInclude = { subjectUser: { select: { id: true, email: true, status: true, role: { select: { key: true } }, agentProfile: { select: { id: true, displayName: true } }, clientContact: { select: { clientId: true, client: { select: { companyName: true } } } } } }, reportedBy: { select: { email: true } }, resolvedBy: { select: { email: true } } } as const;

function canSee(actor: Actor, inc: { reportedById: string }) {
  if (actor.permissions.has("incident.read")) return true;
  return actor.permissions.has("incident.write") && inc.reportedById === actor.userId;
}

export async function createIncident(db: PrismaClient, actor: Actor, input: z.infer<typeof incidentSchema>) {
  authorize(actor, "incident.write");
  const subject = await db.user.findUnique({ where: { id: input.subjectUserId }, select: { id: true } });
  if (!subject) throw new NotFoundError("Subject user not found");
  return db.$transaction(async (tx) => {
    const inc = await tx.incident.create({ data: { subjectUserId: input.subjectUserId, reportedById: actor.userId, type: input.type, severity: input.severity, description: input.description, relatedType: input.relatedType || undefined, relatedId: input.relatedId || undefined } });
    await audit(tx, { actor, action: "INCIDENT_CREATED", entityType: "Incident", entityId: inc.id, newValue: { subjectUserId: input.subjectUserId, type: input.type, severity: input.severity } });
    await publishEvent(tx, "INCIDENT_CREATED", { incidentId: inc.id, subjectUserId: input.subjectUserId, type: input.type, severity: input.severity, reportedByUserId: actor.userId });
    return inc.id;
  });
}

export async function listIncidents(db: PrismaClient, actor: Actor, status?: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "DISMISSED") {
  if (!actor.permissions.has("incident.read") && !actor.permissions.has("incident.write")) throw new ForbiddenError("Incidents require incident.read or incident.write");
  const where = { ...(status ? { status } : {}), ...(actor.permissions.has("incident.read") ? {} : { reportedById: actor.userId }) };
  const rows = await db.incident.findMany({ where, include: incidentInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
  return rows.map(view);
}

export async function getIncident(db: PrismaClient, actor: Actor, id: string) {
  const inc = await db.incident.findUnique({ where: { id }, include: incidentInclude });
  if (!inc || !canSee(actor, inc)) throw new NotFoundError();
  const evidence = inc.evidenceDocumentIds.length ? await db.document.findMany({ where: { id: { in: inc.evidenceDocumentIds } }, select: { id: true, storageKey: true, createdAt: true, uploadedBy: { select: { email: true } } } }) : [];
  const history = await db.incident.findMany({ where: { subjectUserId: inc.subjectUserId, id: { not: inc.id } }, select: { id: true, type: true, severity: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  return { ...view(inc), evidence: evidence.map((e) => ({ id: e.id, name: e.storageKey.split("/").pop() ?? e.id, uploadedBy: e.uploadedBy.email, createdAt: e.createdAt })), history };
}

export async function incidentsForUser(db: PrismaClient, actor: Actor, subjectUserId: string) {
  if (!actor.permissions.has("incident.read")) return [];
  const rows = await db.incident.findMany({ where: { subjectUserId }, include: incidentInclude, orderBy: { createdAt: "desc" } });
  return rows.map(view);
}

export async function evidenceUploadUrl(db: PrismaClient, actor: Actor, incidentId: string, contentType: string) {
  authorize(actor, "incident.write");
  const inc = await db.incident.findUnique({ where: { id: incidentId } });
  if (!inc || !canSee(actor, inc)) throw new NotFoundError();
  const ext = ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt" } as Record<string, string>)[contentType];
  if (!ext) throw new Error("Evidence must be a PDF, PNG, JPEG, or text file.");
  const key = newStorageKey(`incidents/${inc.id}`, ext);
  return { key, ...(await getStorage().createUploadUrl(key, contentType)) };
}

export async function attachEvidence(db: PrismaClient, actor: Actor, incidentId: string, storageKey: string) {
  authorize(actor, "incident.write");
  const inc = await db.incident.findUnique({ where: { id: incidentId } });
  if (!inc || !canSee(actor, inc)) throw new NotFoundError();
  if (!storageKey.startsWith(`incidents/${inc.id}/`)) throw new ForbiddenError("Storage key does not belong to this incident");
  if (!(await getStorage().exists(storageKey))) throw new Error("The file was not uploaded.");
  await db.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { ownerType: "AGREEMENT", ownerId: inc.id, kind: "INCIDENT_EVIDENCE", storageKey, uploadedById: actor.userId, visibility: "INTERNAL" } });
    await tx.incident.update({ where: { id: inc.id }, data: { evidenceDocumentIds: { push: doc.id } } });
    await audit(tx, { actor, action: "INCIDENT_UPDATED", entityType: "Incident", entityId: inc.id, newValue: { evidenceAdded: doc.id } });
  });
}

export async function evidenceDownloadUrl(db: PrismaClient, actor: Actor, incidentId: string, documentId: string) {
  const inc = await db.incident.findUnique({ where: { id: incidentId } });
  if (!inc || !canSee(actor, inc) || !inc.evidenceDocumentIds.includes(documentId)) throw new NotFoundError();
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError();
  return getStorage().createDownloadUrl(doc.storageKey);
}

export async function transitionIncident(db: PrismaClient, actor: Actor, id: string, to: "UNDER_REVIEW" | "RESOLVED" | "DISMISSED", resolution?: string) {
  authorize(actor, "incident.read");
  const inc = await db.incident.findUnique({ where: { id } });
  if (!inc) throw new NotFoundError();
  if (inc.status === "RESOLVED" || inc.status === "DISMISSED") throw new Error("This incident is closed.");
  if ((to === "RESOLVED" || to === "DISMISSED") && !resolution?.trim()) throw new Error("A resolution note is required.");
  await db.$transaction(async (tx) => {
    await tx.incident.update({ where: { id }, data: { status: to, ...(to !== "UNDER_REVIEW" ? { resolution, resolvedById: actor.userId, resolvedAt: new Date() } : {}) } });
    await audit(tx, { actor, action: "INCIDENT_UPDATED", entityType: "Incident", entityId: id, previousValue: { status: inc.status }, newValue: { status: to }, reason: resolution });
  });
}

/** Suspend the subject user with a reason (user.manage). Suspended users cannot log in; their profile leaves the marketplace. */
export async function suspendUser(db: PrismaClient, actor: Actor, userId: string, reason: string, incidentId?: string) {
  authorize(actor, "user.manage");
  if (!reason.trim()) throw new Error("A reason is required to suspend.");
  if (userId === actor.userId) throw new Error("You cannot suspend yourself.");
  const u = await db.user.findUnique({ where: { id: userId }, include: { agentProfile: { select: { id: true, status: true } }, role: { select: { key: true } } } });
  if (!u) throw new NotFoundError();
  if (u.role.key === "SUPER_ADMIN") throw new ForbiddenError("Super Admin accounts cannot be suspended here");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    await tx.session.deleteMany({ where: { userId } });
    if (u.agentProfile && u.agentProfile.status === "APPROVED") await tx.agentProfile.update({ where: { id: u.agentProfile.id }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
    await audit(tx, { actor, action: "USER_SUSPENDED", entityType: "User", entityId: userId, previousValue: { status: u.status }, newValue: { status: "SUSPENDED", incidentId: incidentId ?? null }, reason });
    await publishEvent(tx, "USER_SUSPENDED", { userId, email: u.email, reason });
  });
}

export async function reinstateUser(db: PrismaClient, actor: Actor, userId: string, reason: string) {
  authorize(actor, "user.manage");
  if (!reason.trim()) throw new Error("A reason is required.");
  const u = await db.user.findUnique({ where: { id: userId }, include: { agentProfile: { select: { id: true, status: true } } } });
  if (!u || u.status !== "SUSPENDED") throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    if (u.agentProfile?.status === "SUSPENDED") await tx.agentProfile.update({ where: { id: u.agentProfile.id }, data: { status: "APPROVED", suspendedAt: null } });
    await audit(tx, { actor, action: "USER_REINSTATED", entityType: "User", entityId: userId, previousValue: { status: "SUSPENDED" }, newValue: { status: "ACTIVE" }, reason });
  });
}

type Row = { id: string; type: string; severity: string; status: string; description: string; relatedType: string | null; relatedId: string | null; resolution: string | null; createdAt: Date; resolvedAt: Date | null; evidenceDocumentIds: string[]; subjectUser: { id: string; email: string; status: string; role: { key: string }; agentProfile: { id: string; displayName: string } | null; clientContact: { clientId: string; client: { companyName: string } } | null }; reportedBy: { email: string }; resolvedBy: { email: string } | null };

function view(i: Row) {
  return {
    id: i.id,
    type: i.type,
    severity: i.severity,
    status: i.status,
    description: i.description,
    relatedType: i.relatedType,
    relatedId: i.relatedId,
    resolution: i.resolution,
    createdAt: i.createdAt,
    resolvedAt: i.resolvedAt,
    evidenceCount: i.evidenceDocumentIds.length,
    subject: { userId: i.subjectUser.id, email: i.subjectUser.email, status: i.subjectUser.status, role: i.subjectUser.role.key, label: i.subjectUser.agentProfile?.displayName ?? i.subjectUser.clientContact?.client.companyName ?? i.subjectUser.email, agentProfileId: i.subjectUser.agentProfile?.id ?? null, clientId: i.subjectUser.clientContact?.clientId ?? null },
    reportedBy: i.reportedBy.email,
    resolvedBy: i.resolvedBy?.email ?? null,
  };
}
