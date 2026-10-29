import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { publicAcademyRepository, type CoachLink } from "@/server/repositories/public-academy.repository";
import { audit } from "@/server/audit/audit";
import { newSlug, retireSlugTx, slugError } from "./slug.service";

/**
 * A coach's public identity. It replaces the part of the email before the `@` wherever a coach is named. The page and the
 * name become public only while the coach has switched it on and has a published, listed course.
 */

export const coachProfileSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the name learners should see.").max(80),
  headline: z.string().trim().max(120).optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().trim().url("Enter a full https:// address").refine((u) => u.startsWith("https://"), "Links must start with https://") })).max(6).default([]),
  isPublic: z.boolean().default(false),
  slug: z.string().trim().toLowerCase().optional(),
});
export type CoachProfileInput = z.input<typeof coachProfileSchema>;

function view(p: NonNullable<Awaited<ReturnType<typeof publicAcademyRepository.findCoachProfileByUser>>>) {
  return { id: p.id, slug: p.slug, displayName: p.displayName, headline: p.headline, bio: p.bio, links: (p.links as CoachLink[] | null) ?? [], isPublic: p.isPublic, hasPhoto: !!p.photoKey };
}
export type CoachProfileView = ReturnType<typeof view>;

export async function getOwnCoachProfile(db: PrismaClient, actor: Actor): Promise<CoachProfileView | null> {
  authorize(actor, "course.create_own");
  const p = await publicAcademyRepository.findCoachProfileByUser(db, actor.userId);
  return p ? view(p) : null;
}

/** Creates the coach's profile on first save (address from the name unless they chose one) and updates it after that. */
export async function saveOwnCoachProfile(db: PrismaClient, actor: Actor, raw: CoachProfileInput): Promise<CoachProfileView> {
  authorize(actor, "course.create_own");
  const input = coachProfileSchema.parse(raw);
  const existing = await publicAcademyRepository.findCoachProfileByUser(db, actor.userId);
  const data = { displayName: input.displayName, headline: input.headline || null, bio: input.bio || null, links: input.links, isPublic: input.isPublic };

  if (!existing) {
    if (input.slug) {
      const problem = await slugError(db, "COACH", input.slug);
      if (problem) throw new Error(problem);
    }
    return db.$transaction(async (tx) => {
      const slug = input.slug || (await newSlug(tx, "COACH", input.displayName));
      const p = await publicAcademyRepository.createCoachProfile(tx, { userId: actor.userId, slug, ...data });
      await audit(tx, { actor, action: "COACH_PROFILE_SAVED", entityType: "CoachProfile", entityId: p.id, newValue: { slug, isPublic: p.isPublic } });
      return view(p);
    });
  }

  const nextSlug = input.slug || existing.slug;
  if (nextSlug !== existing.slug) {
    const problem = await slugError(db, "COACH", nextSlug, existing.id);
    if (problem) throw new Error(problem);
  }
  return db.$transaction(async (tx) => {
    if (nextSlug !== existing.slug) await retireSlugTx(tx, "COACH", existing.id, existing.slug, nextSlug);
    const p = await publicAcademyRepository.updateCoachProfile(tx, existing.id, { ...data, slug: nextSlug });
    await audit(tx, { actor, action: "COACH_PROFILE_SAVED", entityType: "CoachProfile", entityId: p.id, previousValue: { slug: existing.slug, isPublic: existing.isPublic }, newValue: { slug: p.slug, isPublic: p.isPublic } });
    return view(p);
  });
}

export type CoachName = { name: string; /** Set only when the coach's public page exists and is on. */ slug: string | null };

/**
 * The name to show for each coach: their profile's display name, otherwise the part of their email before the `@`
 * (what the app showed before coach profiles existed). `slug` is set only for a coach whose page is public, so a link
 * is never offered to a page that answers 404.
 */
export async function coachNamesFor(db: Db, userIds: string[]): Promise<Map<string, CoachName>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, CoachName>();
  if (ids.length === 0) return out;
  const [profiles, users] = await Promise.all([publicAcademyRepository.coachProfilesByUser(db, ids), publicAcademyRepository.coachEmails(db, ids)]);
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  const listed = new Map<string, boolean>();
  for (const p of profiles) if (p.isPublic) listed.set(p.userId, await publicAcademyRepository.coachHasListedCourse(db, p.userId));
  for (const u of users) {
    const p = byUser.get(u.id);
    out.set(u.id, { name: p?.displayName ?? u.email.split("@")[0], slug: p && p.isPublic && listed.get(u.id) ? p.slug : null });
  }
  return out;
}

/** Is this coach page public right now? (Used by the public coach page and the sitemap.) */
export async function isCoachPageLive(db: Db, coachProfileId: string): Promise<boolean> {
  const p = await publicAcademyRepository.findCoachSlugById(db, coachProfileId);
  return !!p && p.isPublic && (await publicAcademyRepository.coachHasListedCourse(db, p.userId));
}
