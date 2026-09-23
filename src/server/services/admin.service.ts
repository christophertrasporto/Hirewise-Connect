import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { agentRepository } from "@/server/repositories/agent.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { audit } from "@/server/audit/audit";
import { notifyUser } from "./notification.service";
import { getSetting } from "./setting.service";
import { getStorage } from "@/server/adapters/storage";
import { reviewTransition } from "./agent.service";
import { setVerificationManually, type Level } from "./verification.service";

/**
 * Phase 5 admin tooling: bulk actions over agents, broadcast notifications, and the
 * data-protection pieces from Section 14 Q18 (anonymisation on request, retention job).
 */

export const bulkAgentSchema = z.object({
  agentProfileIds: z.array(z.string().min(1)).min(1, "Select at least one agent.").max(200),
  op: z.enum(["HIDE", "UNHIDE", "SET_AVAILABILITY", "SET_VERIFICATION", "NOTIFY"]),
  availability: z.enum(["AVAILABLE", "AVAILABLE_SOON", "UNAVAILABLE", "PAUSED"]).optional(),
  level: z.enum(["PROFILE_SUBMITTED", "PROFILE_VERIFIED", "SKILLS_ASSESSED", "HIREWISE_CERTIFIED", "INTERVIEW_READY", "DEPLOYMENT_READY"]).optional(),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  body: z.string().trim().max(2000).optional().or(z.literal("")),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Each item goes through the same service function a single action would, so guards and audit rows are identical. */
export async function bulkAgentAction(db: PrismaClient, actor: Actor, input: z.infer<typeof bulkAgentSchema>): Promise<{ done: number; failed: Array<{ id: string; error: string }> }> {
  const failed: Array<{ id: string; error: string }> = [];
  let done = 0;
  for (const id of input.agentProfileIds) {
    try {
      if (input.op === "HIDE") await reviewTransition(db, actor, id, "HIDDEN", input.reason || "Bulk hide");
      else if (input.op === "UNHIDE") await reviewTransition(db, actor, id, "APPROVED", input.reason || "Bulk unhide");
      else if (input.op === "SET_AVAILABILITY") {
        authorize(actor, "agent.set_availability");
        if (!input.availability) throw new Error("Choose an availability.");
        await db.$transaction(async (tx) => {
          const before = await agentRepository.availabilityOf(tx, id);
          if (before === null) throw new NotFoundError();
          if (before === "PLACED" || before === "RESERVED") throw new Error("Placed or reserved agents are managed through placements and reservations.");
          await agentRepository.setAvailability(tx, id, input.availability!, { setById: actor.userId, reason: input.reason || "Bulk update" });
          await audit(tx, { actor, action: "AVAILABILITY_CHANGED", entityType: "AgentProfile", entityId: id, previousValue: { status: before }, newValue: { status: input.availability }, reason: input.reason || "Bulk update" });
        });
      } else if (input.op === "SET_VERIFICATION") {
        if (!input.level) throw new Error("Choose a level.");
        await setVerificationManually(db, actor, id, input.level as Level, input.reason || "Bulk update");
      } else if (input.op === "NOTIFY") {
        authorize(actor, "notification.broadcast");
        if (!input.title || !input.body) throw new Error("Title and body are required.");
        const p = await agentRepository.findByIdForStaff(db, id);
        if (!p) throw new NotFoundError();
        await notifyUser(db, { userId: p.userId, type: "BROADCAST", title: input.title, body: input.body, email: { to: p.user.email }, dedupeKey: `BC:${actor.userId}:${input.title}:${Date.now() >> 12}:${id}` });
      }
      done++;
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (input.op === "NOTIFY") await audit(db, { actor, action: "NOTIFICATION_BROADCAST", entityType: "AgentProfile", entityId: "bulk", newValue: { count: done, title: input.title } });
  return { done, failed };
}

export const broadcastSchema = z.object({
  roles: z.array(z.enum(["AGENT", "CLIENT", "SALES", "RECRUITER", "COACH", "OPERATIONS", "ADMIN"])).min(1, "Pick at least one audience."),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(2000),
  email: z.coerce.boolean().default(false),
});

/** Broadcast to whole roles (notification.broadcast). Suspended and deleted users are skipped. */
export async function broadcastNotification(db: PrismaClient, actor: Actor, input: z.infer<typeof broadcastSchema>) {
  authorize(actor, "notification.broadcast");
  const users = await db.user.findMany({ where: { status: "ACTIVE", deletedAt: null, role: { key: { in: input.roles } } }, select: { id: true, email: true } });
  const stamp = Date.now() >> 12;
  for (const u of users) await notifyUser(db, { userId: u.id, type: "BROADCAST", title: input.title, body: input.body, email: input.email ? { to: u.email } : undefined, dedupeKey: `BC:${actor.userId}:${input.title}:${stamp}` });
  await audit(db, { actor, action: "NOTIFICATION_BROADCAST", entityType: "User", entityId: "broadcast", newValue: { roles: input.roles, recipients: users.length, title: input.title, email: input.email } });
  return users.length;
}

// ---------------------------------------------------------------------------
// Data protection (Q18): anonymisation on request and the retention job
// ---------------------------------------------------------------------------

/**
 * Irreversibly scrub personal data for one user while keeping commercial and audit records
 * (invoices, placements, audit rows reference ids only). Requires user.manage and a reason.
 */
export async function anonymiseUser(db: PrismaClient, actor: Actor, userId: string, reason: string) {
  authorize(actor, "user.manage");
  if (!reason.trim()) throw new Error("A reason is required (e.g. deletion request reference).");
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: { select: { key: true } }, agentProfile: { include: { privateContact: true, videos: true, recordings: true, portfolioItems: true } }, clientContact: true } });
  if (!u) throw new NotFoundError();
  if (u.role.key === "SUPER_ADMIN") throw new ForbiddenError("Super Admin accounts cannot be anonymised here");
  if (u.agentProfile) {
    const open = await db.placement.count({ where: { agentProfileId: u.agentProfile.id, status: { in: ["AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE", "PAUSED"] } } });
    if (open > 0) throw new Error("The agent has an open placement. Complete or cancel it first.");
  }
  const keys: string[] = [];
  await db.$transaction(async (tx) => {
    const now = new Date();
    const scrubbedEmail = `deleted-${u.id}@anonymised.invalid`;
    await tx.session.deleteMany({ where: { userId } });
    await tx.authToken.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { email: scrubbedEmail, passwordHash: null, mfaEnabled: false, mfaSecretEnc: null, status: "DEACTIVATED", deletedAt: now } });
    if (u.agentProfile) {
      const p = u.agentProfile;
      await tx.agentProfile.update({ where: { id: p.id }, data: { displayName: "Former talent", headline: null, summary: null, photoKey: null, locationCity: null, equipmentSummary: null, internetSummary: null, status: "HIDDEN", hiddenAt: now, availabilityStatus: "UNAVAILABLE", deletedAt: now } });
      if (p.privateContact) await tx.agentPrivateContact.update({ where: { id: p.privateContact.id }, data: { fullLegalName: "Anonymised", personalEmail: null, phone: null, addressLine: null, resumeKey: null, governmentIdRefs: undefined } });
      await tx.experience.updateMany({ where: { agentProfileId: p.id }, data: { company: null, description: null } });
      await tx.video.updateMany({ where: { agentProfileId: p.id }, data: { status: "RETIRED" } });
      keys.push(...p.videos.map((v) => v.storageKey), ...p.recordings.map((r) => r.storageKey), ...(p.privateContact?.resumeKey ? [p.privateContact.resumeKey] : []), ...(p.photoKey ? [p.photoKey] : []));
      await tx.recording.deleteMany({ where: { agentProfileId: p.id } });
      await tx.portfolio.deleteMany({ where: { agentProfileId: p.id } });
      await tx.interviewMessage.updateMany({ where: { authorUserId: userId }, data: { body: "[removed at the author's request]" } });
    }
    if (u.clientContact) {
      await tx.clientContact.update({ where: { id: u.clientContact.id }, data: { name: "Former contact", businessEmail: scrubbedEmail, phone: null } });
      await tx.interviewMessage.updateMany({ where: { authorUserId: userId }, data: { body: "[removed at the author's request]" } });
    }
    await tx.notification.deleteMany({ where: { userId } });
    await audit(tx, { actor, action: "USER_ANONYMISED", entityType: "User", entityId: userId, previousValue: { role: u.role.key }, newValue: { deletedAt: now.toISOString() }, reason });
  });
  // Best effort object deletion after the transaction commits.
  const storage = getStorage();
  for (const k of keys) await storage.delete(k).catch(() => {});
  return { removedObjects: keys.length };
}

/** Accounts eligible for the retention job: soft-deleted or deactivated longer than retentionDays, not yet anonymised. */
export async function retentionCandidates(db: PrismaClient, actor: Actor) {
  authorize(actor, "user.manage");
  const days = await getSetting(db, "retentionDays");
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db.user.findMany({ where: { OR: [{ deletedAt: { lte: cutoff } }, { status: "DEACTIVATED", updatedAt: { lte: cutoff } }, { status: "SUSPENDED", updatedAt: { lte: cutoff } }], NOT: { email: { endsWith: "@anonymised.invalid" } }, role: { key: { in: ["AGENT", "CLIENT"] } } }, select: { id: true, email: true, status: true, deletedAt: true, updatedAt: true, role: { select: { key: true } } }, take: 200 });
  return { retentionDays: days, cutoff, candidates: rows.map((r) => ({ id: r.id, email: r.email, status: r.status, role: r.role.key, since: r.deletedAt ?? r.updatedAt })) };
}

/** Admin-run retention job (Q18): anonymises every candidate, one transaction each. */
export async function runRetention(db: PrismaClient, actor: Actor) {
  authorize(actor, "user.manage");
  const { candidates, retentionDays } = await retentionCandidates(db, actor);
  let done = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const c of candidates) {
    try {
      await anonymiseUser(db, actor, c.id, `Retention job: inactive for more than ${retentionDays} days`);
      done++;
    } catch (e) {
      failed.push({ id: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await audit(db, { actor, action: "RETENTION_RUN", entityType: "User", entityId: "retention", newValue: { considered: candidates.length, anonymised: done, failed: failed.length } });
  return { considered: candidates.length, done, failed };
}

export async function listUsersForAdmin(db: PrismaClient, actor: Actor, q?: string) {
  authorize(actor, "user.manage");
  return userRepository.search(db, q);
}
