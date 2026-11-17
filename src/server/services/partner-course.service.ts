import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { UserMessageError } from "@/server/policies/user-message-error";
import { academyRepository } from "@/server/repositories/academy.repository";
import { publicAcademyRepository } from "@/server/repositories/public-academy.repository";
import { audit } from "@/server/audit/audit";
import { rateLimit } from "@/server/auth/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { cleanPartnerText, parsePartnerUrl } from "@/lib/partner-course";
import { resolveCourseSlug } from "./slug.service";

/**
 * Partner courses: a course taught on another site, reached through an affiliate link. Only an Admin (`course.manage`)
 * sets the link. The link never appears in a view or a page: visitors press `/go/<slug>`, which calls
 * `partnerDestination` to log the click and get the address to redirect to.
 */

export type PartnerLinkInput = { url: string; provider: string; priceLabel?: string };

/** Makes a course a partner course, changes its link, or (with null) turns it back into an ordinary course. */
export async function setPartnerLink(db: PrismaClient, actor: Actor, courseId: string, input: PartnerLinkInput | null) {
  authorize(actor, "course.manage");
  const c = await academyRepository.findCourse(db, courseId);
  if (!c) throw new NotFoundError();

  let next: { externalUrl: string | null; externalProvider: string | null; externalPriceLabel: string | null };
  if (input === null) {
    next = { externalUrl: null, externalProvider: null, externalPriceLabel: null };
  } else {
    const link = parsePartnerUrl(input.url, siteUrl());
    if (!link.ok) throw new UserMessageError(link.message);
    const provider = cleanPartnerText(input.provider, 80);
    if (!provider) throw new UserMessageError("Enter the partner's name, for example Udemy.");
    if (!c.externalUrl && (await publicAcademyRepository.enrolmentCount(db, c.id)) > 0) {
      throw new UserMessageError("This course already has learners enrolled, so it cannot become a partner course.");
    }
    next = { externalUrl: link.url, externalProvider: provider, externalPriceLabel: cleanPartnerText(input.priceLabel, 40) };
  }

  await db.$transaction(async (tx) => {
    await publicAcademyRepository.setPartnerLink(tx, c.id, next);
    // The address itself is not audited as a value to read back later; the audit says what changed and who changed it.
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, previousValue: { partnerCourse: !!c.externalUrl, provider: c.externalProvider }, newValue: { partnerCourse: !!next.externalUrl, provider: next.externalProvider, op: "partner-link" } });
  });
}

/**
 * Called by /go/<slug>. Takes no actor because the page is public; `actor` is only used to note who pressed the button.
 * Returns the address to redirect to, or null when there is none (unknown slug, not published, not a partner course).
 * Counting is best effort: a flood from one place (`ip`) is still redirected, just not counted.
 */
export async function partnerDestination(db: PrismaClient, slug: string, who: { userId: string | null; ip: string | null; /** False for prefetches and crawlers: still redirected, never counted. */ count?: boolean }): Promise<{ url: string } | { redirectSlug: string } | null> {
  const found = await resolveCourseSlug(db, slug);
  if (!found) return null;
  if (found.type === "REDIRECT") return { redirectSlug: found.slug };
  const target = await publicAcademyRepository.partnerTarget(db, found.id);
  if (!target?.externalUrl) return null;
  if (who.count === false) return { url: target.externalUrl };
  try {
    rateLimit(`partner-click:${who.ip ?? who.userId ?? "unknown"}`, 60, 60 * 60_000);
    await publicAcademyRepository.recordClick(db, target.id, who.userId);
  } catch {
    // not counted; the visitor still goes where they asked to go
  }
  return { url: target.externalUrl };
}

/** Click counts per course for the staff Academy page: all time and the last 30 days. */
export async function partnerClickCounts(db: PrismaClient, actor: Actor): Promise<Map<string, { total: number; recent: number }>> {
  authorize(actor, "course.manage");
  return publicAcademyRepository.clickCounts(db, new Date(Date.now() - 30 * 24 * 60 * 60_000));
}
