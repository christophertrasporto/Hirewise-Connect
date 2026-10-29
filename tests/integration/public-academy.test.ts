import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, publishCourse, submitCourseForApproval, rejectCourse, publishOwnCourse, archiveCourse } from "@/server/services/academy.service";
import { savePublicDetails, setCourseListing, setCourseFeatured } from "@/server/services/public-course.service";
import { resolveCourseSlug, resolveCoachSlug } from "@/server/services/slug.service";
import { getOwnCoachProfile, saveOwnCoachProfile, coachNamesFor, isCoachPageLive } from "@/server/services/coach-profile.service";
import { writeReview, hideReview, unhideReview, courseRatingSummary, listCourseReviews, listReviewsForStaff } from "@/server/services/review.service";
import { setSetting } from "@/server/services/setting.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { FORBIDDEN_FOR_CLIENT, collectKeys } from "@/server/views/forbidden-keys";

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
let categoryId = "";

const coach = () => makeActor("COACH", { userId: ids.coach });
const otherCoach = () => makeActor("COACH", { userId: ids.otherCoach });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const owner = () => makeActor("SUPER_ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const client = () => makeActor("CLIENT", { clientId: "c1" });
const learner = (k: string) => makeActor("AGENT", { userId: ids[k], agentProfileId: profiles[k] });

async function mkUser(key: string, email: string, role: RoleKey, displayName?: string) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: displayName ?? key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

const input = (title: string) => ({ title, categoryId, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER" as const, price: "", passingScore: 70 });

/** A course with one published module and lesson, so it can be submitted or published. */
async function courseWithLesson(title: string, owner = coach) {
  const id = await createCourse(db, owner(), input(title));
  const m = await db.courseModule.create({ data: { courseId: id, order: 1, title: "Module 1", status: "PUBLISHED" } });
  await db.courseLesson.create({ data: { moduleId: m.id, order: 1, title: "Lesson 1", contentType: "TEXT", body: "Hello", status: "PUBLISHED" } });
  return id;
}

const enrolWith = (courseId: string, key: string, paymentStatus: "PAID" | "WAIVED" | "NOT_REQUIRED" | "PENDING" | "REFUNDED") =>
  db.courseEnrollment.create({ data: { courseId, agentProfileId: profiles[key], priceCents: 100_000, currency: "PHP", paymentStatus, paidCents: paymentStatus === "PAID" ? 100_000 : null } });

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("sales", "sales@hirewise.example", "SALES");
  await mkUser("coach", "maria.coach@hirewise.example", "COACH");
  await mkUser("otherCoach", "other.coach@hirewise.example", "COACH");
  await mkUser("owner", "owner@talent.example", "AGENT", "Maria Santos");
  await mkUser("waived", "waived@talent.example", "AGENT", "Juan dela Cruz");
  await mkUser("refunded", "refunded@talent.example", "AGENT", "Ana Reyes");
  await mkUser("pending", "pending@talent.example", "AGENT", "Pat Pending");
  await mkUser("stranger", "stranger@talent.example", "AGENT", "Sam Stranger");
  categoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("course slugs", () => {
  it("a new course gets a slug from its title, and a repeated title gets a numbered one", async () => {
    const a = await createCourse(db, coach(), input("Cold Calling Masterclass!"));
    const b = await createCourse(db, coach(), input("Cold Calling Masterclass"));
    const sa = (await db.academyCourse.findUniqueOrThrow({ where: { id: a } })).slug;
    const sb = (await db.academyCourse.findUniqueOrThrow({ where: { id: b } })).slug;
    expect(sa).toBe("cold-calling-masterclass");
    expect(sb).toBe("cold-calling-masterclass-2");
  });

  it("a reserved word never becomes a slug", async () => {
    const id = await createCourse(db, coach(), input("Category"));
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).slug).toBe("category-course");
  });

  it("changing the slug keeps the old one as a redirect, and the old address resolves to the new one", async () => {
    const id = await createCourse(db, coach(), input("Appointment Setting 101"));
    expect(await resolveCourseSlug(db, "appointment-setting-101")).toEqual({ type: "FOUND", id });
    await savePublicDetails(db, coach(), id, { slug: "setting-appointments" });
    expect(await resolveCourseSlug(db, "setting-appointments")).toEqual({ type: "FOUND", id });
    expect(await resolveCourseSlug(db, "appointment-setting-101")).toEqual({ type: "REDIRECT", slug: "setting-appointments" });
    // And again: the first slug now points at the latest address, not at the middle one.
    await savePublicDetails(db, coach(), id, { slug: "book-more-appointments" });
    expect(await resolveCourseSlug(db, "appointment-setting-101")).toEqual({ type: "REDIRECT", slug: "book-more-appointments" });
    expect(await resolveCourseSlug(db, "setting-appointments")).toEqual({ type: "REDIRECT", slug: "book-more-appointments" });
    expect(await resolveCourseSlug(db, "no-such-course")).toBeNull();
  });

  it("a retired slug cannot be taken by another course, but its owner can take it back", async () => {
    const mine = await createCourse(db, coach(), input("Closing Deals"));
    const theirs = await createCourse(db, coach(), input("Negotiation Basics"));
    await savePublicDetails(db, coach(), mine, { slug: "closing-deals-pro" });
    await expect(savePublicDetails(db, coach(), theirs, { slug: "closing-deals" })).rejects.toThrow(/already in use/);
    await savePublicDetails(db, coach(), mine, { slug: "closing-deals" });
    expect(await resolveCourseSlug(db, "closing-deals")).toEqual({ type: "FOUND", id: mine });
    expect(await resolveCourseSlug(db, "closing-deals-pro")).toEqual({ type: "REDIRECT", slug: "closing-deals" });
  });

  it("refuses a bad, short, reserved or taken slug", async () => {
    const id = await createCourse(db, coach(), input("Slug Rules"));
    const other = await createCourse(db, coach(), input("Slug Rules Two"));
    const otherSlug = (await db.academyCourse.findUniqueOrThrow({ where: { id: other } })).slug;
    for (const [slug, re] of [["ab", /at least 3/], ["Has Spaces", /lower-case/], ["double--hyphen", /lower-case/], ["category", /reserved/], [otherSlug, /already in use/]] as const) {
      await expect(savePublicDetails(db, coach(), id, { slug })).rejects.toThrow(re);
    }
  });
});

describe("public details and listing", () => {
  it("saves the pitch, learning points, audience, requirements and FAQ for the owner and an admin; another coach and sales cannot", async () => {
    const id = await createCourse(db, coach(), input("Details Course"));
    await savePublicDetails(db, coach(), id, { pitch: "Book more calls.", learningPoints: ["Open a call", "Handle objections"], audience: "New setters", requirements: "A headset", faq: [{ question: "Is it live?", answer: "No, self-paced." }] });
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id } });
    expect(c.pitch).toBe("Book more calls.");
    expect(c.learningPoints).toEqual(["Open a call", "Handle objections"]);
    expect(c.faq).toEqual([{ question: "Is it live?", answer: "No, self-paced." }]);
    await savePublicDetails(db, admin(), id, { pitch: "Admin edit." });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).pitch).toBe("Admin edit.");
    await expect(savePublicDetails(db, otherCoach(), id, { pitch: "x" })).rejects.toThrow(NotFoundError);
    await expect(savePublicDetails(db, sales(), id, { pitch: "x" })).rejects.toThrow(ForbiddenError);
    await expect(savePublicDetails(db, client(), id, { pitch: "x" })).rejects.toThrow(ForbiddenError);
  });

  it("only an admin can hide the enrolled count; a coach's attempt is ignored", async () => {
    const id = await createCourse(db, coach(), input("Count Course"));
    await savePublicDetails(db, coach(), id, { hideEnrolledCount: true });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).hideEnrolledCount).toBe(false);
    await savePublicDetails(db, admin(), id, { hideEnrolledCount: true });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).hideEnrolledCount).toBe(true);
  });

  it("rejects too many learning points, an over-long pitch, and a bad FAQ entry", async () => {
    const id = await createCourse(db, coach(), input("Limits Course"));
    await expect(savePublicDetails(db, coach(), id, { learningPoints: Array.from({ length: 11 }, (_, i) => `Point ${i}`) })).rejects.toThrow();
    await expect(savePublicDetails(db, coach(), id, { pitch: "x".repeat(281) })).rejects.toThrow();
    await expect(savePublicDetails(db, coach(), id, { faq: [{ question: "?", answer: "" }] })).rejects.toThrow();
  });

  it("listing defaults to LISTED; the owner and an admin can unlist and relist; others cannot", async () => {
    const id = await createCourse(db, coach(), input("Listing Course"));
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).listing).toBe("LISTED");
    await setCourseListing(db, coach(), id, "UNLISTED");
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).listing).toBe("UNLISTED");
    await setCourseListing(db, admin(), id, "LISTED");
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).listing).toBe("LISTED");
    await expect(setCourseListing(db, otherCoach(), id, "UNLISTED")).rejects.toThrow(NotFoundError);
    await expect(setCourseListing(db, sales(), id, "UNLISTED")).rejects.toThrow(ForbiddenError);
  });
});

describe("featured courses", () => {
  it("admin features a published, listed course; unlisting or archiving removes the feature; others cannot feature", async () => {
    const id = await courseWithLesson("Featured Course");
    await expect(setCourseFeatured(db, admin(), id, 1)).rejects.toThrow(/published, listed/); // still a draft
    await publishCourse(db, admin(), id, {});
    await setCourseFeatured(db, admin(), id, 2);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).featuredRank).toBe(2);
    await expect(setCourseFeatured(db, coach(), id, 1)).rejects.toThrow(ForbiddenError);
    await expect(setCourseFeatured(db, admin(), id, 0)).rejects.toThrow(/whole number/);
    await setCourseListing(db, coach(), id, "UNLISTED");
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).featuredRank).toBeNull();
    await setCourseListing(db, coach(), id, "LISTED");
    await setCourseFeatured(db, admin(), id, 1);
    await archiveCourse(db, admin(), id);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).featuredRank).toBeNull();
    await setCourseFeatured(db, admin(), id, null); // clearing is always allowed
  });
});

describe("approval: reject with a reason, and self-publishing when approval is off", () => {
  it("rejecting sends the course back to draft with the reason, notifies the coach, and resubmitting clears it", async () => {
    const id = await courseWithLesson("Reject Me");
    await submitCourseForApproval(db, coach(), id);
    await expect(rejectCourse(db, coach(), id, "Not good enough")).rejects.toThrow(ForbiddenError);
    await expect(rejectCourse(db, sales(), id, "Not good enough")).rejects.toThrow(ForbiddenError);
    await expect(rejectCourse(db, admin(), id, "no")).rejects.toThrow(/at least 5/);
    await rejectCourse(db, admin(), id, "Add a welcome video and a clearer description.");
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe("DRAFT");
    expect(c.reviewNote).toBe("Add a welcome video and a clearer description.");
    expect(await db.auditLog.count({ where: { action: "COURSE_REJECTED", entityId: id } })).toBe(1);
    const ev = await db.outboxEvent.findFirst({ where: { type: "COURSE_REJECTED" } });
    expect(ev?.payload).toMatchObject({ courseId: id, coachUserId: ids.coach, reason: "Add a welcome video and a clearer description." });
    await submitCourseForApproval(db, coach(), id);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).reviewNote).toBeNull();
  });

  it("only a course waiting for approval can be rejected", async () => {
    const id = await courseWithLesson("Not Pending");
    await expect(rejectCourse(db, admin(), id, "Some reason here")).rejects.toThrow(/waiting for approval/);
    await expect(rejectCourse(db, admin(), "missing-id", "Some reason here")).rejects.toThrow(NotFoundError);
  });

  it("publishing clears an old rejection note", async () => {
    const id = await courseWithLesson("Fix And Publish");
    await submitCourseForApproval(db, coach(), id);
    await rejectCourse(db, admin(), id, "Please fix the title.");
    await publishCourse(db, admin(), id, {});
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).reviewNote).toBeNull();
  });

  it("a coach cannot publish their own course while approval is required (the default)", async () => {
    const id = await courseWithLesson("Needs Approval");
    await expect(publishOwnCourse(db, coach(), id)).rejects.toThrow(ForbiddenError);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });

  it("with approval switched off a coach publishes their own draft, but it still needs a published lesson and ownership", async () => {
    await setSetting(db, owner(), "academy", { requireApproval: false });
    const empty = await createCourse(db, coach(), input("No Lessons Yet"));
    await expect(publishOwnCourse(db, coach(), empty)).rejects.toThrow(/at least one published lesson/);
    const id = await courseWithLesson("Self Published");
    await expect(publishOwnCourse(db, otherCoach(), id)).rejects.toThrow(NotFoundError);
    await expect(publishOwnCourse(db, sales(), id)).rejects.toThrow(ForbiddenError);
    await publishOwnCourse(db, coach(), id);
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe("PUBLISHED");
    expect(c.publishedById).toBe(ids.coach);
    await expect(publishOwnCourse(db, coach(), id)).rejects.toThrow(/Only a draft/);
    await setSetting(db, owner(), "academy", { requireApproval: true });
  });
});

describe("coach profiles", () => {
  it("a coach creates their profile (slug from the name), edits it, and is private until they switch it on", async () => {
    expect(await getOwnCoachProfile(db, coach())).toBeNull();
    const p = await saveOwnCoachProfile(db, coach(), { displayName: "Maria Coach", headline: "Setter trainer", bio: "Ten years of calls.", links: [{ label: "LinkedIn", url: "https://linkedin.com/in/maria" }], isPublic: false });
    expect(p.slug).toBe("maria-coach");
    expect(p.isPublic).toBe(false);
    const q = await saveOwnCoachProfile(db, coach(), { displayName: "Maria the Coach", headline: "Setter trainer", links: [], isPublic: true });
    expect(q.slug).toBe("maria-coach");
    expect(q.displayName).toBe("Maria the Coach");
    expect((await getOwnCoachProfile(db, coach()))?.links).toEqual([]);
  });

  it("only coaches (or admins who manage courses) have a coach profile; sales, clients and learners cannot", async () => {
    for (const a of [sales(), client(), learner("owner")]) {
      await expect(saveOwnCoachProfile(db, a, { displayName: "Someone", links: [], isPublic: false })).rejects.toThrow(ForbiddenError);
      await expect(getOwnCoachProfile(db, a)).rejects.toThrow(ForbiddenError);
    }
  });

  it("refuses non-https links, too many links and a one-letter name", async () => {
    await expect(saveOwnCoachProfile(db, otherCoach(), { displayName: "A", links: [], isPublic: false })).rejects.toThrow();
    await expect(saveOwnCoachProfile(db, otherCoach(), { displayName: "Other Coach", links: [{ label: "x", url: "http://insecure.example" }], isPublic: false })).rejects.toThrow(/https/);
    await expect(saveOwnCoachProfile(db, otherCoach(), { displayName: "Other Coach", links: [{ label: "x", url: "javascript:alert(1)" }], isPublic: false })).rejects.toThrow();
    await expect(saveOwnCoachProfile(db, otherCoach(), { displayName: "Other Coach", links: Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, url: `https://e.example/${i}` })), isPublic: false })).rejects.toThrow();
  });

  it("two coaches with the same name get different slugs, and a changed slug redirects", async () => {
    const a = await saveOwnCoachProfile(db, otherCoach(), { displayName: "Maria Coach", links: [], isPublic: false });
    expect(a.slug).toBe("maria-coach-2");
    await saveOwnCoachProfile(db, otherCoach(), { displayName: "Maria Coach", slug: "maria-two", links: [], isPublic: false });
    expect(await resolveCoachSlug(db, "maria-coach-2")).toEqual({ type: "REDIRECT", slug: "maria-two" });
    await expect(saveOwnCoachProfile(db, otherCoach(), { displayName: "Maria Coach", slug: "maria-coach", links: [], isPublic: false })).rejects.toThrow(/already in use/);
  });

  it("the name shown is the profile name, falling back to the email prefix; a link is offered only when the page is public with a listed course", async () => {
    // Earlier tests gave this coach published, listed courses, so the public page is live.
    let names = await coachNamesFor(db, [ids.coach, ids.otherCoach, ids.admin]);
    expect(names.get(ids.coach)).toEqual({ name: "Maria the Coach", slug: "maria-coach" });
    expect(names.get(ids.otherCoach)).toEqual({ name: "Maria Coach", slug: null }); // profile exists but is private
    expect(names.get(ids.admin)).toEqual({ name: "admin", slug: null }); // no profile: the email prefix
    const profile = await db.coachProfile.findUniqueOrThrow({ where: { userId: ids.coach } });
    expect(await isCoachPageLive(db, profile.id)).toBe(true);

    // Public but with no published listed course: the name shows, the page is not live, no link is offered.
    await saveOwnCoachProfile(db, otherCoach(), { displayName: "Maria Coach", slug: "maria-two", links: [], isPublic: true });
    names = await coachNamesFor(db, [ids.otherCoach]);
    expect(names.get(ids.otherCoach)).toEqual({ name: "Maria Coach", slug: null });
    const other = await db.coachProfile.findUniqueOrThrow({ where: { userId: ids.otherCoach } });
    expect(await isCoachPageLive(db, other.id)).toBe(false);

    // Once the coach has a published, listed course the page goes live; unlisting it takes the page down again.
    const id = await courseWithLesson("Other Coach Course", otherCoach);
    await publishCourse(db, admin(), id, {});
    expect((await coachNamesFor(db, [ids.otherCoach])).get(ids.otherCoach)?.slug).toBe("maria-two");
    await setCourseListing(db, otherCoach(), id, "UNLISTED");
    expect((await coachNamesFor(db, [ids.otherCoach])).get(ids.otherCoach)?.slug).toBeNull();
  });
});

describe("reviews", () => {
  let courseId = "";
  beforeAll(async () => {
    courseId = await courseWithLesson("Reviewed Course");
    await publishCourse(db, admin(), courseId, {});
    await enrolWith(courseId, "owner", "PAID");
    await enrolWith(courseId, "waived", "WAIVED");
    await enrolWith(courseId, "refunded", "REFUNDED");
    await enrolWith(courseId, "pending", "PENDING");
  });

  it("an owner reviews once; writing again edits the same review", async () => {
    const id = await writeReview(db, learner("owner"), courseId, { rating: 5, body: "Great course." });
    const again = await writeReview(db, learner("owner"), courseId, { rating: 4, body: "Great, with one gap." });
    expect(again).toBe(id);
    expect(await db.courseReview.count({ where: { courseId } })).toBe(1);
    expect((await db.courseReview.findUniqueOrThrow({ where: { id } })).rating).toBe(4);
  });

  it("a waived learner may review; refunded, unpaid, never-enrolled learners, coaches, clients and staff may not", async () => {
    await writeReview(db, learner("waived"), courseId, { rating: 3 });
    for (const a of [learner("refunded"), learner("pending"), learner("stranger"), coach(), client(), admin()]) {
      await expect(writeReview(db, a, courseId, { rating: 5 })).rejects.toThrow(ForbiddenError);
    }
  });

  it("a revoked enrolment loses the right to review", async () => {
    await db.courseEnrollment.update({ where: { courseId_agentProfileId: { courseId, agentProfileId: profiles.waived } }, data: { accessRevokedAt: new Date() } });
    await expect(writeReview(db, learner("waived"), courseId, { rating: 1 })).rejects.toThrow(ForbiddenError);
    await db.courseEnrollment.update({ where: { courseId_agentProfileId: { courseId, agentProfileId: profiles.waived } }, data: { accessRevokedAt: null } });
  });

  it("a draft or unknown course cannot be reviewed", async () => {
    const draft = await courseWithLesson("Draft Reviews");
    await enrolWith(draft, "owner", "PAID");
    await expect(writeReview(db, learner("owner"), draft, { rating: 5 })).rejects.toThrow(NotFoundError);
    await expect(writeReview(db, learner("owner"), "missing-id", { rating: 5 })).rejects.toThrow(NotFoundError);
  });

  it("the rating must be a whole number from 1 to 5", async () => {
    for (const rating of [0, 6, 2.5, -1]) await expect(writeReview(db, learner("owner"), courseId, { rating })).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "CourseReview" SET "rating" = 9 WHERE "courseId" = ${courseId}`).rejects.toThrow(/rating_range|check/i);
  });

  it("readers see the average, the count and 'First L.' only; no learner id, profile id or email reaches the list", async () => {
    expect(await courseRatingSummary(db, courseId)).toEqual({ count: 2, average: 3.5 });
    const list = await listCourseReviews(db, courseId);
    expect(list.map((r) => r.author).sort()).toEqual(["Juan C.", "Maria S."]);
    const json = JSON.stringify(list);
    for (const secret of [ids.owner, profiles.owner, "owner@talent.example", "Santos", "dela Cruz"]) expect(json).not.toContain(secret);
    const keys = collectKeys(list);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), k).toBe(false);
    expect(await courseRatingSummary(db, ids.coach)).toEqual({ count: 0, average: null });
  });

  it("an admin hides a review with a reason: it leaves the average and the list, staff still see it, and it can be shown again", async () => {
    const r = await db.courseReview.findFirstOrThrow({ where: { courseId, userId: ids.waived } });
    await expect(hideReview(db, coach(), r.id, "Spam and abuse")).rejects.toThrow(ForbiddenError);
    await expect(hideReview(db, sales(), r.id, "Spam and abuse")).rejects.toThrow(ForbiddenError);
    await expect(hideReview(db, admin(), r.id, "no")).rejects.toThrow(/at least 5/);
    await expect(hideReview(db, admin(), "missing", "Spam and abuse")).rejects.toThrow(NotFoundError);
    await hideReview(db, admin(), r.id, "Spam and abuse");
    expect(await courseRatingSummary(db, courseId)).toEqual({ count: 1, average: 4 });
    expect((await listCourseReviews(db, courseId)).map((x) => x.author)).toEqual(["Maria S."]);
    const staffList = await listReviewsForStaff(db, admin(), courseId);
    expect(staffList.find((x) => x.id === r.id)).toMatchObject({ hidden: true, hiddenReason: "Spam and abuse" });
    await expect(listReviewsForStaff(db, coach(), courseId)).rejects.toThrow(ForbiddenError);
    expect(await db.auditLog.count({ where: { action: "REVIEW_HIDDEN", entityId: r.id } })).toBe(1);
    await unhideReview(db, admin(), r.id);
    expect(await courseRatingSummary(db, courseId)).toEqual({ count: 2, average: 3.5 });
    await expect(unhideReview(db, coach(), r.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("coaches and referral codes", () => {
  it("a coach is an eligible referral member (so the Share button can carry their code)", async () => {
    const { referralRepository } = await import("@/server/repositories/referral.repository");
    expect(referralRepository.isEligibleRole("COACH")).toBe(true);
    expect(referralRepository.isEligibleRole("CLIENT")).toBe(false);
    expect(referralRepository.isEligibleRole("ADMIN")).toBe(false);
  });
});
