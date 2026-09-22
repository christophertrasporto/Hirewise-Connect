import type { PrismaClient, Tx } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { placementRepository } from "@/server/repositories/placement.repository";
import { toPlacementView } from "@/server/views/interview.views";

/**
 * Placement record created at client selection (Section 5.5, status SELECTED).
 * The commercial pipeline (approval, agreement, deposit, activation) is Phase 4.
 */
export async function createPlacementFromSelection(tx: Tx, actor: Actor, p: { clientId: string; agentProfileId: string; requirementId: string | null; interviewRequestId: string; interviewId: string; positionTitle: string; schedule: string | null; timezone: string | null; startDate: Date | null; accountManagerUserId: string | null }) {
  const existing = await placementRepository.findOpenForPair(tx, p.clientId, p.agentProfileId);
  if (existing) return existing;
  void actor;
  return placementRepository.create(tx, p);
}

export async function listPlacementsForClient(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  return (await placementRepository.listForClient(db, actor.clientId)).map((p) => toPlacementView(p, "CLIENT"));
}

export async function listPlacementsForAgent(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return [];
  return (await placementRepository.listForAgent(db, actor.agentProfileId)).map((p) => toPlacementView(p, "AGENT"));
}

export async function listPlacementsForStaff(db: PrismaClient, actor: Actor, status?: "PENDING" | "INTERVIEWING" | "SELECTED" | "AWAITING_AGREEMENT" | "AWAITING_DEPOSIT" | "DEPLOYMENT_PREP" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED") {
  authorize(actor, "placement.read_all");
  return (await placementRepository.listForStaff(db, status)).map((p) => toPlacementView(p, "STAFF"));
}

export async function getPlacementForStaff(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "placement.read_all");
  const p = await placementRepository.findById(db, id);
  if (!p) throw new NotFoundError();
  return toPlacementView(p, "STAFF");
}
