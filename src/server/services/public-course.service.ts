import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { publicAcademyRepository } from "@/server/repositories/public-academy.repository";
import { audit } from "@/server/audit/audit";
import { loadEditableCourse } from "./academy.service";
import { retireSlugTx, slugError } from "./slug.service";

/**
 * What the public course page says beyond the basics (pitch, what you will learn, who it is for, requirements, FAQ), the
 * course address, whether it is listed, and whether it is featured. Coaches and Admins edit the content and the listing of
 * a course they may edit; only Admins hide the enrolled count or feature a course.
 */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const publicDetailsSchema = z.object({
  pitch: optionalText(280),
  learningPoints: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
  audience: optionalText(1000),
  requirements: optionalText(1000),
  faq: z.array(z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(3).max(1000) })).max(12).default([]),
  slug: z.string().trim().toLowerCase().optional(),
  hideEnrolledCount: z.boolean().optional(),
});
export type PublicDetailsInput = z.input<typeof publicDetailsSchema>;

export async function savePublicDetails(db: PrismaClient, actor: Actor, courseId: string, raw: PublicDetailsInput) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = publicDetailsSchema.parse(raw);
  const nextSlug = input.slug || c.slug;
  if (nextSlug !== c.slug) {
    const problem = await slugError(db, "COURSE", nextSlug, c.id);
    if (problem) throw new Error(problem);
  }
  const canHideCount = actor.permissions.has("course.manage");
  await db.$transaction(async (tx) => {
    if (nextSlug !== c.slug) await retireSlugTx(tx, "COURSE", c.id, c.slug, nextSlug);
    await publicAcademyRepository.updateCourseDetails(tx, c.id, {
      slug: nextSlug,
      pitch: input.pitch || null,
      learningPoints: input.learningPoints,
      audience: input.audience || null,
      requirements: input.requirements || null,
      faq: input.faq,
      ...(canHideCount && input.hideEnrolledCount !== undefined ? { hideEnrolledCount: input.hideEnrolledCount } : {}),
    });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, newValue: { publicDetails: true } });
    if (nextSlug !== c.slug) await audit(tx, { actor, action: "COURSE_SLUG_CHANGED", entityType: "AcademyCourse", entityId: c.id, previousValue: { slug: c.slug }, newValue: { slug: nextSlug } });
  });
  return nextSlug;
}

/** Listed courses show in the catalog, search, categories and sitemap; unlisted ones only by link. Unlisting also un-features. */
export async function setCourseListing(db: PrismaClient, actor: Actor, courseId: string, listing: "LISTED" | "UNLISTED") {
  const c = await loadEditableCourse(db, actor, courseId);
  if (c.listing === listing) return;
  await db.$transaction(async (tx) => {
    await publicAcademyRepository.setListing(tx, c.id, listing);
    if (listing === "UNLISTED" && c.featuredRank !== null) await publicAcademyRepository.setFeaturedRank(tx, c.id, null);
    await audit(tx, { actor, action: "COURSE_LISTING_CHANGED", entityType: "AcademyCourse", entityId: c.id, previousValue: { listing: c.listing }, newValue: { listing } });
  });
}

/** Admin: a featured course shows first in the catalog, lowest rank first. `null` removes it from the featured row. */
export async function setCourseFeatured(db: PrismaClient, actor: Actor, courseId: string, rank: number | null) {
  authorize(actor, "course.manage");
  const c = await publicAcademyRepository.findCourseSlugById(db, courseId);
  if (!c) throw new Error("Course not found.");
  if (rank !== null) {
    if (!Number.isInteger(rank) || rank < 1 || rank > 999) throw new Error("Use a whole number from 1 to 999.");
    if (c.status !== "PUBLISHED" || c.listing !== "LISTED") throw new Error("Only a published, listed course can be featured.");
  }
  await db.$transaction(async (tx) => {
    await publicAcademyRepository.setFeaturedRank(tx, c.id, rank);
    await audit(tx, { actor, action: "COURSE_FEATURED_SET", entityType: "AcademyCourse", entityId: c.id, newValue: { featuredRank: rank } });
  });
}

/** The public-page settings of a course, for the coach or admin who edits them. */
export async function getPublicDetails(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  return {
    courseId: c.id,
    status: c.status,
    slug: c.slug,
    listing: c.listing,
    pitch: c.pitch ?? "",
    learningPoints: c.learningPoints,
    audience: c.audience ?? "",
    requirements: c.requirements ?? "",
    faq: ((c.faq as Array<{ question: string; answer: string }> | null) ?? []),
    hideEnrolledCount: c.hideEnrolledCount,
    featuredRank: c.featuredRank,
    reviewNote: c.reviewNote,
  };
}
export type PublicDetailsView = Awaited<ReturnType<typeof getPublicDetails>>;
