import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { searchFiltersSchema, type SearchFilters } from "./search.service";

/** Client portal saved searches (Section 13 Phase 5). Filters reuse the marketplace search schema. */

export const savedSearchNameSchema = z.string().trim().min(2, "Give the search a name.").max(60);

function ownClientId(actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) throw new ForbiddenError("Saved searches are for client accounts");
  return actor.clientId;
}

export async function saveSearch(db: PrismaClient, actor: Actor, name: string, filters: SearchFilters) {
  const clientId = ownClientId(actor);
  const parsed = searchFiltersSchema.parse(filters);
  const clean = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
  const row = await db.savedSearch.upsert({ where: { clientId_name: { clientId, name: savedSearchNameSchema.parse(name) } }, create: { clientId, createdById: actor.userId, name: savedSearchNameSchema.parse(name), filters: clean }, update: { filters: clean } });
  return row.id;
}

export async function listSavedSearches(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  const rows = await db.savedSearch.findMany({ where: { clientId: actor.clientId }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, filters: (r.filters ?? {}) as SearchFilters, lastRunAt: r.lastRunAt, query: toQuery((r.filters ?? {}) as SearchFilters) }));
}

export async function deleteSavedSearch(db: PrismaClient, actor: Actor, id: string) {
  const clientId = ownClientId(actor);
  const row = await db.savedSearch.findUnique({ where: { id } });
  if (!row || row.clientId !== clientId) throw new NotFoundError();
  await db.savedSearch.delete({ where: { id } });
}

export async function touchSavedSearch(db: PrismaClient, actor: Actor, id: string) {
  const clientId = ownClientId(actor);
  await db.savedSearch.updateMany({ where: { id, clientId }, data: { lastRunAt: new Date() } });
}

/** Query string for /talent from a saved filter set. */
export function toQuery(f: SearchFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === "" || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
    else q.set(k, String(v));
  }
  return q.toString();
}
