import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError } from "@/server/policies/authorize";
import { flagRepository } from "@/server/repositories/flag.repository";
import { threadRepository } from "@/server/repositories/thread.repository";
import { ensureRequestThread, postToThread, listThreadMessages, reviewHeldThreadMessage, listHeldThreadMessages } from "@/server/services/thread.service";

/**
 * Interview-request messaging (Sections 8.5, 8.8), now a thin wrapper over the mediated threads of v2 phase 6a.
 * Callers keep addressing the interview request; the thread is looked up (or created for older requests).
 */

type Visibility = "ALL" | "HIREWISE_ONLY" | "CLIENT_AND_HIREWISE" | "AGENT_AND_HIREWISE" | "AGENCY_AND_HIREWISE";

async function threadIdFor(db: PrismaClient, actor: Actor, requestId: string) {
  const existing = await threadRepository.findByRequest(db, requestId);
  return (existing ?? (await ensureRequestThread(db, actor, requestId))).id;
}

export async function postMessage(db: PrismaClient, actor: Actor, requestId: string, body: string, visibleTo?: Visibility) {
  return postToThread(db, actor, await threadIdFor(db, actor, requestId), body, visibleTo);
}

/** Messages the actor may see on the request's thread. Held messages are visible only to their author and to Hirewise. */
export async function listMessages(db: PrismaClient, actor: Actor, requestId: string) {
  return (await listThreadMessages(db, actor, await threadIdFor(db, actor, requestId))).messages;
}

export async function threadIdForRequest(db: PrismaClient, actor: Actor, requestId: string) {
  return threadIdFor(db, actor, requestId);
}

export const reviewHeldMessage = reviewHeldThreadMessage;
export const listHeldMessages = listHeldThreadMessages;

export async function listOpenFlags(db: PrismaClient, actor: Actor) {
  authorize(actor, "flag.review");
  return flagRepository.listOpen(db);
}

export async function markFlagReviewed(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "flag.review");
  await flagRepository.markReviewed(db, id, actor.userId);
}

export function assertCanPost(actor: Actor) {
  if (!["CLIENT", "AGENT"].includes(actor.role) && !actor.permissions.has("interview.coordinate") && !actor.permissions.has("thread.moderate")) throw new ForbiddenError("Not allowed");
}
