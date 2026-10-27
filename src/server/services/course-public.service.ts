import type { Actor } from "@/server/auth/actor";
import type { PrismaClient } from "@/server/db/types";
import { NotFoundError } from "@/server/policies/authorize";
import { entitledToCourse } from "@/server/policies/lesson-access";
import { academyRepository } from "@/server/repositories/academy.repository";
import { lessonAccessRepository } from "@/server/repositories/lesson-access.repository";
import { lessonAgentView, priceLabel, visibleModules } from "@/server/views/academy.views";
import { coverUrlFor } from "./course-cover";

/**
 * The public face of a published course: what a visitor, signed in or not, may see before buying. The curriculum shows
 * titles, types, durations, and which lessons are free previews. Only free-preview lessons carry playable content, and
 * the only video address in the result is our own lesson route (which re-checks the access rule and answers with a
 * short-lived signed URL); a gated lesson never has a source, link, body, or storage key here.
 */

export type ViewerState =
  /** Not signed in. */
  | "SIGNED_OUT"
  /** Signed in as talent, not enrolled. */
  | "CAN_BUY"
  /** Enrolled, payment still pending. */
  | "PENDING"
  /** Owns the course (free, paid, or waived, not refunded or revoked). */
  | "OWNER"
  /** Owned it once; access was refunded or revoked. */
  | "ENDED"
  /** Signed in as someone who cannot buy courses (clients, agencies, staff). */
  | "NOT_TALENT";

export async function getPublicCourse(db: PrismaClient, actor: Actor | null, courseId: string) {
  const c = await academyRepository.findCourse(db, courseId);
  if (!c || c.status !== "PUBLISHED") throw new NotFoundError();

  const modules = visibleModules(c);
  const lessons = modules.flatMap((m) => m.lessons);
  const previewLessons = lessons.filter((l) => l.isFreePreview);

  let state: ViewerState = actor ? "NOT_TALENT" : "SIGNED_OUT";
  let enrollmentId: string | null = null;
  if (actor?.role === "AGENT" && actor.agentProfileId) {
    const e = await lessonAccessRepository.findEnrollment(db, c.id, actor.agentProfileId);
    enrollmentId = e?.id ?? null;
    state = !e ? "CAN_BUY" : entitledToCourse(e) ? "OWNER" : e.paymentStatus === "PENDING" ? "PENDING" : "ENDED";
  }

  return {
    id: c.id,
    title: c.title,
    description: c.description,
    category: c.categoryRef?.name ?? c.category,
    difficulty: c.difficulty,
    estimatedMinutes: c.estimatedMinutes,
    priceCents: c.priceCents,
    priceLabel: priceLabel(c.priceCents, c.currency),
    certification: c.certificationTemplate?.name ?? null,
    coverUrl: await coverUrlFor(c),
    state,
    enrollmentId,
    lessonCount: lessons.length,
    previewCount: previewLessons.length,
    /** Titles, types, durations, and the preview flag, for every published lesson. Nothing playable. */
    curriculum: modules.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, contentType: l.contentType, durationSec: l.durationSec, isFreePreview: l.isFreePreview })) })),
    /** The free-preview lessons as the lesson player renders them, in course order. */
    previewModules: [{ id: "preview", order: 0, title: "Free preview", description: null, isRequired: false, lessons: previewLessons.map(lessonAgentView) }].filter((m) => m.lessons.length > 0),
  };
}

export type PublicCourse = Awaited<ReturnType<typeof getPublicCourse>>;
