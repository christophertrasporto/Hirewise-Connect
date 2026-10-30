export type SlugKind = "COURSE" | "COACH";
import type { Db } from "@/server/db/types";
import { publicAcademyRepository } from "@/server/repositories/public-academy.repository";
import { baseSlug, firstFreeSlug, slugProblem } from "@/lib/slug";

/**
 * Addresses for courses and coaches. A slug that was ever in use is never handed to someone else: a retired slug stays in
 * `SlugRedirect` and answers 301 to the current address, so shared links and search results keep working. The owner may take
 * a retired slug back, which removes its redirect.
 */

const repo = publicAcademyRepository;

async function taken(db: Db, kind: SlugKind, slug: string, selfId?: string): Promise<boolean> {
  const live = kind === "COURSE" ? await repo.courseSlugTaken(db, slug, selfId) : await repo.coachSlugTaken(db, slug, selfId);
  if (live) return true;
  const redirect = await repo.redirectFor(db, kind, slug);
  return !!redirect && redirect.targetId !== selfId;
}

/** A free slug for a new course or coach, from their title or name. */
export async function newSlug(db: Db, kind: SlugKind, text: string, selfId?: string): Promise<string> {
  return firstFreeSlug(baseSlug(text, kind === "COURSE" ? "course" : "coach"), (c) => taken(db, kind, c, selfId));
}

/** Checks a slug someone typed. Returns the problem to show, or null when it can be used. */
export async function slugError(db: Db, kind: SlugKind, slug: string, selfId?: string): Promise<string | null> {
  const problem = slugProblem(slug);
  if (problem) return problem;
  return (await taken(db, kind, slug, selfId)) ? "That address is already in use." : null;
}

/**
 * Moves a course or coach to a new slug inside the caller's transaction: the old slug becomes a redirect, and a redirect
 * for the new slug that pointed at this same record is dropped. The caller writes the new slug on the record itself.
 */
export async function retireSlugTx(tx: Db, kind: SlugKind, targetId: string, oldSlug: string, nextSlug: string) {
  if (oldSlug === nextSlug) return;
  await repo.dropRedirect(tx, kind, nextSlug);
  await repo.saveRedirect(tx, kind, oldSlug, targetId);
}

export type SlugResolution = { type: "FOUND"; id: string } | { type: "REDIRECT"; slug: string } | null;

/** Public address lookup: the record when the slug is current, the current slug when it was retired, otherwise nothing. */
export async function resolveCourseSlug(db: Db, slug: string): Promise<SlugResolution> {
  const c = await repo.findCourseBySlug(db, slug);
  if (c) return { type: "FOUND", id: c.id };
  const r = await repo.redirectFor(db, "COURSE", slug);
  const target = r ? await repo.findCourseSlugById(db, r.targetId) : null;
  return target ? { type: "REDIRECT", slug: target.slug } : null;
}

export async function resolveCoachSlug(db: Db, slug: string): Promise<SlugResolution> {
  const c = await repo.findCoachBySlug(db, slug);
  if (c) return { type: "FOUND", id: c.id };
  const r = await repo.redirectFor(db, "COACH", slug);
  const target = r ? await repo.findCoachSlugById(db, r.targetId) : null;
  return target ? { type: "REDIRECT", slug: target.slug } : null;
}
