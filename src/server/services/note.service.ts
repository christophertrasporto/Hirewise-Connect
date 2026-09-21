import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { noteRepository } from "@/server/repositories/note.repository";

export const noteInputSchema = z.object({
  body: z.string().trim().min(2, "Write a note.").max(4000),
  visibility: z.enum(["INTERNAL", "AGENT", "CLIENT"]).default("INTERNAL"),
  pinned: z.coerce.boolean().default(false),
});

/** Internal notes on an agent or client. INTERNAL by default; never shown to agents or clients unless designated (INV-P4). */
export async function addNote(db: PrismaClient, actor: Actor, subjectType: "AGENT" | "CLIENT", subjectId: string, input: z.infer<typeof noteInputSchema>) {
  authorize(actor, "note.internal.write");
  await noteRepository.create(db, { subjectType, subjectId, authorUserId: actor.userId, body: input.body, visibility: input.visibility, pinned: input.pinned });
}

export async function listNotesForStaff(db: PrismaClient, actor: Actor, subjectType: "AGENT" | "CLIENT", subjectId: string) {
  authorize(actor, "note.internal.read");
  const notes = await noteRepository.listForSubject(db, subjectType, subjectId, ["INTERNAL", "AGENT", "CLIENT"]);
  const authors = new Map((await noteRepository.authorsByIds(db, [...new Set(notes.map((n) => n.authorUserId))])).map((a) => [a.id, a]));
  return notes.map((n) => ({ id: n.id, body: n.body, visibility: n.visibility, pinned: n.pinned, createdAt: n.createdAt, author: authors.get(n.authorUserId)?.email ?? "unknown", authorRole: authors.get(n.authorUserId)?.role.key ?? null }));
}

/** What the subject themselves may see: only notes explicitly designated for them. */
export async function listNotesForSubject(db: PrismaClient, actor: Actor, subjectType: "AGENT" | "CLIENT", subjectId: string) {
  const visibility = actor.role === "AGENT" ? "AGENT" : actor.role === "CLIENT" ? "CLIENT" : null;
  if (!visibility) return [];
  const own = (actor.role === "AGENT" && actor.agentProfileId === subjectId) || (actor.role === "CLIENT" && actor.clientId === subjectId);
  if (!own) return [];
  const notes = await noteRepository.listForSubject(db, subjectType, subjectId, [visibility]);
  return notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt }));
}
