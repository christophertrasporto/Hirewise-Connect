import type { Db } from "@/server/db/types";
import type { DomainEventMap, DomainEventType } from "./events";
import { notifyUser } from "@/server/services/notification.service";
import { userRepository } from "@/server/repositories/user.repository";
import { taskRepository } from "@/server/repositories/task.repository";

export type EventHandler<T extends DomainEventType> = (db: Db, payload: DomainEventMap[T]) => Promise<void>;

async function notifyStaff(db: Db, roles: Array<"SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "OPERATIONS">, n: { type: string; title: string; body: string; dedupeKey: string; email?: boolean }) {
  const staff = await userRepository.idsByRole(db, roles);
  for (const s of staff) {
    await notifyUser(db, { userId: s.id, type: n.type, title: n.title, body: n.body, dedupeKey: `${n.dedupeKey}:${s.id}`, email: n.email ? { to: s.email } : undefined });
  }
}

/**
 * Event → side-effects (Section 9). Handlers must be idempotent: the worker may
 * retry an event if the process dies after the handler but before markProcessed.
 */
export const EVENT_HANDLERS: { [T in DomainEventType]: EventHandler<T> } = {
  USER_CREATED: async (db, p) => {
    await notifyUser(db, {
      userId: p.userId,
      type: "WELCOME",
      title: "Welcome to Hirewise Connect",
      body: "Your account has been created. Complete the required agreements to continue.",
      email: { to: p.email },
      dedupeKey: `WELCOME:${p.userId}`,
    });
  },

  SETTING_CHANGED: async () => {},

  CLIENT_REGISTERED: async (db, p) => {
    await notifyStaff(db, ["SALES", "ADMIN"], {
      type: "NEW_CLIENT_REGISTRATION",
      title: `New client registration: ${p.companyName}`,
      body: "Review the requirement and activate the account so the client can browse talent.",
      dedupeKey: `NEW_CLIENT:${p.clientId}`,
      email: true,
    });
    const existing = await taskRepository.findOpenByRelated(db, "QUALIFY_CLIENT", "Client", p.clientId);
    if (!existing) {
      await taskRepository.create(db, { type: "QUALIFY_CLIENT", title: `Qualify and activate ${p.companyName}`, queueRole: "SALES", dueAt: new Date(Date.now() + 24 * 60 * 60_000), relatedType: "Client", relatedId: p.clientId });
    }
  },

  CLIENT_ACTIVATED: async (db, p) => {
    await notifyUser(db, {
      userId: p.userId,
      type: "CLIENT_ACTIVATED",
      title: "Your Hirewise Connect account is active",
      body: `${p.companyName} can now browse verified talent, shortlist candidates, and request interviews.`,
      email: { to: p.email },
      dedupeKey: `CLIENT_ACTIVATED:${p.clientId}`,
    });
    await taskRepository.completeByRelated(db, "QUALIFY_CLIENT", "Client", p.clientId);
  },

  AGENT_REGISTERED: async (db, p) => {
    await notifyStaff(db, ["RECRUITER"], {
      type: "NEW_AGENT_REGISTRATION",
      title: `New talent registration: ${p.displayName}`,
      body: "The agent is completing their profile. You will be notified when it is submitted for review.",
      dedupeKey: `NEW_AGENT:${p.agentProfileId}`,
    });
  },

  PROFILE_SUBMITTED: async (db, p) => {
    await notifyStaff(db, ["RECRUITER", "ADMIN"], {
      type: "PROFILE_SUBMITTED",
      title: `Profile submitted for review: ${p.displayName}`,
      body: "Open the recruiter queue to review the profile, résumé, and media.",
      dedupeKey: `PROFILE_SUBMITTED:${p.agentProfileId}`,
      email: true,
    });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_PROFILE", "AgentProfile", p.agentProfileId);
    if (!existing) {
      await taskRepository.create(db, { type: "REVIEW_PROFILE", title: `Review profile: ${p.displayName}`, queueRole: "RECRUITER", dueAt: new Date(Date.now() + 2 * 24 * 60 * 60_000), relatedType: "AgentProfile", relatedId: p.agentProfileId });
    }
  },

  PROFILE_REVIEWED: async (db, p) => {
    const copy = {
      APPROVED: { title: "Your profile is approved", body: "Your Hirewise Connect profile is now visible to vetted clients. Keep your availability up to date." },
      REVISION_REQUIRED: { title: "Your profile needs changes", body: p.feedback ? `Hirewise feedback: ${p.feedback}` : "Hirewise has requested changes. Open your profile to see the feedback." },
      REJECTED: { title: "Profile review outcome", body: p.feedback ? `Hirewise decision: ${p.feedback}` : "Your profile was not approved at this time." },
    }[p.outcome];
    await notifyUser(db, { userId: p.userId, type: `PROFILE_${p.outcome}`, title: copy.title, body: copy.body, email: { to: p.email }, dedupeKey: `PROFILE_${p.outcome}:${p.agentProfileId}:${Date.now() >> 20}` });
    if (p.outcome !== "REVISION_REQUIRED") await taskRepository.completeByRelated(db, "REVIEW_PROFILE", "AgentProfile", p.agentProfileId);
  },
};
