import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorizeAny } from "@/server/policies/authorize";
import { agentRepository } from "@/server/repositories/agent.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { mediaRepository } from "@/server/repositories/media.repository";
import { taskRepository } from "@/server/repositories/task.repository";
import { notificationRepository } from "@/server/repositories/notification.repository";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";

/** Admin / management counters (Section "Admin dashboard"), filtered to what the role may see. */
export async function staffDashboard(db: PrismaClient, actor: Actor) {
  authorizeAny(actor, ["agent.read_public", "client.read", "course.read_assigned"]);
  const canAgents = actor.permissions.has("agent.read_public");
  const canClients = actor.permissions.has("client.read");

  const [agentCounts, clientCounts, media, queueTasks, myTasks] = await Promise.all([
    canAgents ? agentRepository.countByStatus(db) : Promise.resolve([]),
    canClients ? clientRepository.countByStatus(db) : Promise.resolve([]),
    actor.permissions.has("media.review") ? mediaRepository.countPendingReview(db) : Promise.resolve([0, 0] as [number, number]),
    ["SALES", "RECRUITER", "ADMIN", "SUPER_ADMIN", "OPERATIONS"].includes(actor.role) ? taskRepository.openForQueue(db, actor.role === "SUPER_ADMIN" ? "ADMIN" : actor.role) : Promise.resolve([]),
    taskRepository.openForUser(db, actor.userId),
  ]);

  const agents = Object.fromEntries(agentCounts.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const clients = Object.fromEntries(clientCounts.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const availableAgents = canAgents ? await agentRepository.countAvailable(db) : 0;

  return {
    agents: {
      total: Object.values(agents).reduce((a, b) => a + b, 0),
      approved: agents.APPROVED ?? 0,
      pending: (agents.SUBMITTED ?? 0) + (agents.UNDER_REVIEW ?? 0),
      draft: agents.DRAFT ?? 0,
      revision: agents.REVISION_REQUIRED ?? 0,
      available: availableAgents,
    },
    clients: { total: Object.values(clients).reduce((a, b) => a + b, 0), pending: clients.PENDING_REVIEW ?? 0, active: clients.ACTIVE ?? 0 },
    media: { videosPending: media[0], recordingsPending: media[1] },
    shortlists: actor.permissions.has("shortlist.read_all") ? await shortlistRepository.countActive(db) : 0,
    tasks: { queue: queueTasks.map(taskView), mine: myTasks.map(taskView) },
    visibility: { agents: canAgents, clients: canClients, media: actor.permissions.has("media.review") },
  };
}

function taskView(t: { id: string; type: string; title: string; dueAt: Date | null; status: string; relatedType: string | null; relatedId: string | null }) {
  return { id: t.id, type: t.type, title: t.title, dueAt: t.dueAt, status: t.status, relatedType: t.relatedType, relatedId: t.relatedId };
}

export async function listNotifications(db: PrismaClient, actor: Actor) {
  const rows = await notificationRepository.listForUser(db, actor.userId);
  return rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, readAt: n.readAt, createdAt: n.createdAt }));
}

export async function markNotificationRead(db: PrismaClient, actor: Actor, id: string) {
  await notificationRepository.markRead(db, actor.userId, id);
}
