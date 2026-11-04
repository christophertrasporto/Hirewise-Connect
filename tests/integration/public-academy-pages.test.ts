import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { getCatalog, getCatalogCategories, getCategory, getPublicCoursePage, getPublicCoachPage, sitemapEntries, getCourseViewer, shareLinkFor, isShareablePath, publicCoverKey, publicSlugForCourseId, coachPhotoAccess } from "@/server/services/public-catalog.service";
import { savePublicDetails } from "@/server/services/public-course.service";
import { saveOwnCoachProfile, createCoachPhotoUploadUrl, setCoachPhoto } from "@/server/services/coach-profile.service";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { DEFAULT_CATALOG_QUERY, type CatalogQuery } from "@/lib/public-catalog";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";

const db = testDb();
let dir = "";
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
const course: Record<string, string> = {};
let salesId = "";
let supportId = "";
const png = Buffer.from("89504e470d0a1a0a", "hex");

const coach1 = () => makeActor("COACH", { userId: ids.coach1 });
const coach2 = () => makeActor("COACH", { userId: ids.coach2 });
const learner = (k: string) => makeActor("AGENT", { userId: ids[k], agentProfileId: profiles[k] });
const client = () => makeActor("CLIENT", { clientId: "c1" });
const q = (over: Partial<CatalogQuery> = {}): CatalogQuery => ({ ...DEFAULT_CATALOG_QUERY, ...over });
const titles = async (over: Partial<CatalogQuery> = {}) => (await getCatalog(db, q(over), { withFeatured: false })).cards.map((c) => c.title);

async function mkUser(key: string, email: string, role: RoleKey, displayName?: string) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: displayName ?? key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

type CourseSeed = { key: string; title: string; slug: string; owner: string; status?: "PUBLISHED" | "DRAFT" | "ARCHIVED"; listing?: "LISTED" | "UNLISTED"; priceCents?: number; currency?: string; difficulty?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"; categoryId?: string; pitch?: string; publishedAt?: Date; featuredRank?: number; hideEnrolledCount?: boolean; thumbnailKey?: string };

async function mkCourse(s: CourseSeed) {
  const c = await db.academyCourse.create({
    data: {
      code: s.slug.toUpperCase(),
      title: s.title,
      slug: s.slug,
      category: "Sales",
      categoryId: s.categoryId ?? salesId,
      description: `${s.title}: a course description long enough to satisfy validation rules.`,
      pitch: s.pitch,
      ownerCoachUserId: ids[s.owner],
      status: s.status ?? "PUBLISHED",
      listing: s.listing ?? "LISTED",
      priceCents: s.priceCents ?? 0,
      currency: s.currency ?? "PHP",
      difficulty: s.difficulty ?? "BEGINNER",
      publishedAt: s.publishedAt ?? new Date("2026-01-01T00:00:00Z"),
      featuredRank: s.featuredRank,
      hideEnrolledCount: s.hideEnrolledCount ?? false,
      thumbnailKey: s.thumbnailKey,
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    },
  });
  await db.courseCoach.create({ data: { courseId: c.id, coachUserId: ids[s.owner] } });
  course[s.key] = c.id;
  return c.id;
}

const enrol = (key: string, who: string, paymentStatus: "PAID" | "WAIVED" | "NOT_REQUIRED" | "PENDING" | "REFUNDED") =>
  db.courseEnrollment.create({ data: { courseId: course[key], agentProfileId: profiles[who], priceCents: 100_000, currency: "PHP", paymentStatus, paidCents: paymentStatus === "PAID" ? 100_000 : null } });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-pubacademy-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  resetRateLimits();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("coach1", "maria.coach@hirewise.example", "COACH");
  await mkUser("coach2", "hank.hidden@hirewise.example", "COACH");
  await mkUser("coach3", "nobody.coach@hirewise.example", "COACH");
  await mkUser("coach4", "unlisted.only@hirewise.example", "COACH");
  await mkUser("owner", "owner@talent.example", "AGENT", "Maria Santos");
  await mkUser("second", "second@talent.example", "AGENT", "Juan dela Cruz");
  await mkUser("refunded", "refunded@talent.example", "AGENT", "Ana Reyes");
  await mkUser("pending", "pending@talent.example", "AGENT", "Pat Pending");
  await mkUser("stranger", "stranger@talent.example", "AGENT", "Sam Stranger");
  salesId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
  supportId = (await db.courseCategory.create({ data: { name: "Support", slug: "support", order: 2 } })).id;
  await db.courseCategory.create({ data: { name: "Empty Category", slug: "empty-category", order: 3 } });

  await saveOwnCoachProfile(db, coach1(), { displayName: "Maria Cruz", headline: "Setter trainer", bio: "Ten years of calls.", links: [{ label: "LinkedIn", url: "https://linkedin.com/in/maria" }], isPublic: true });
  await saveOwnCoachProfile(db, coach2(), { displayName: "Hank Hidden", links: [], isPublic: false });
  await saveOwnCoachProfile(db, makeActor("COACH", { userId: ids.coach4 }), { displayName: "Una Unlisted", links: [], isPublic: true });

  await mkCourse({ key: "cold", title: "Cold Calling Pro", slug: "cold-calling-pro", owner: "coach1", pitch: "Win more calls every day", featuredRank: 1, publishedAt: new Date("2026-03-01T00:00:00Z") });
  await mkCourse({ key: "closing", title: "Sales Closing Intensive", slug: "sales-closing-intensive", owner: "coach2", priceCents: 250_000, difficulty: "INTERMEDIATE", publishedAt: new Date("2026-02-01T00:00:00Z") });
  await mkCourse({ key: "support", title: "Support Basics", slug: "support-basics", owner: "coach3", priceCents: 100_000, difficulty: "ADVANCED", categoryId: supportId, hideEnrolledCount: true, thumbnailKey: "courses/support/cover/a.png", publishedAt: new Date("2026-01-15T00:00:00Z") });
  await mkCourse({ key: "gem", title: "Hidden Gem", slug: "hidden-gem", owner: "coach4", listing: "UNLISTED" });
  await mkCourse({ key: "draft", title: "Draft Course", slug: "draft-course", owner: "coach1", status: "DRAFT" });
  await mkCourse({ key: "old", title: "Old Course", slug: "old-course", owner: "coach1", status: "ARCHIVED" });

  // Cold Calling Pro: one free-preview upload, a gated text lesson, a gated hosted video, and a quiz wrongly flagged as a preview.
  const m = await db.courseModule.create({ data: { courseId: course.cold, order: 1, title: "Start here", status: "PUBLISHED" } });
  const lesson = (order: number, d: Record<string, unknown>) => db.courseLesson.create({ data: { moduleId: m.id, order, status: "PUBLISHED", ...d } as never });
  await lesson(1, { title: "Welcome video", contentType: "VIDEO", storageKey: "lessons/secret/welcome.mp4", fileName: "welcome.mp4", isFreePreview: true, durationSec: 120 });
  await lesson(2, { title: "The script", contentType: "TEXT", body: "SECRET BODY of a gated lesson", durationSec: 60 });
  await lesson(3, { title: "Live demo", contentType: "VIDEO", url: "https://youtube.com/watch?v=SECRETURL", durationSec: 300 });
  await lesson(4, { title: "Final quiz", contentType: "QUIZ", isFreePreview: true });
  await db.courseLesson.create({ data: { moduleId: m.id, order: 5, title: "Unpublished draft lesson", contentType: "TEXT", body: "DRAFT ONLY", status: "DRAFT" } });
  const m2 = await db.courseModule.create({ data: { courseId: course.closing, order: 1, title: "Closing", status: "PUBLISHED" } });
  await db.courseLesson.create({ data: { moduleId: m2.id, order: 1, title: "Closers", contentType: "TEXT", body: "Another gated body", status: "PUBLISHED" } });

  await enrol("cold", "owner", "PAID");
  await enrol("cold", "second", "WAIVED");
  await enrol("cold", "refunded", "REFUNDED");
  await enrol("cold", "pending", "PENDING");
  await enrol("closing", "owner", "PAID");
  await enrol("support", "owner", "PAID");
  const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: course.cold, agentProfileId: profiles.owner } });
  const e2 = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: course.cold, agentProfileId: profiles.second } });
  await db.courseReview.create({ data: { courseId: course.cold, enrollmentId: e.id, userId: ids.owner, rating: 5, body: "Great course" } });
  await db.courseReview.create({ data: { courseId: course.cold, enrollmentId: e2.id, userId: ids.second, rating: 3, body: "Hidden one", hiddenAt: new Date(), hiddenReason: "spam spam" } });
});

afterAll(async () => {
  resetStorageForTests();
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

describe("the catalog shows only published, listed courses", () => {
  it("leaves out unlisted, draft and archived courses", async () => {
    const all = await titles();
    expect(all.sort()).toEqual(["Cold Calling Pro", "Sales Closing Intensive", "Support Basics"]);
    for (const hidden of ["Hidden Gem", "Draft Course", "Old Course"]) expect(all).not.toContain(hidden);
  });

  it("searches title, description, pitch and a public coach name, never an email or a private coach", async () => {
    expect(await titles({ q: "cold" })).toEqual(["Cold Calling Pro"]);
    expect(await titles({ q: "WIN MORE CALLS" })).toEqual(["Cold Calling Pro"]);
    expect(await titles({ q: "long enough to satisfy" })).toHaveLength(3);
    expect(await titles({ q: "Maria Cruz" })).toEqual(["Cold Calling Pro"]);
    expect(await titles({ q: "Hank" })).toEqual([]);
    expect(await titles({ q: "hirewise.example" })).toEqual([]);
    expect(await titles({ q: "maria.coach" })).toEqual([]);
    // A search never reaches an unlisted or draft course.
    expect(await titles({ q: "Hidden Gem" })).toEqual([]);
    expect(await titles({ q: "Draft" })).toEqual([]);
  });

  it("filters by category, level, price and free preview", async () => {
    expect((await titles({ category: "sales" })).sort()).toEqual(["Cold Calling Pro", "Sales Closing Intensive"]);
    expect(await titles({ category: "support" })).toEqual(["Support Basics"]);
    expect(await titles({ category: "empty-category" })).toEqual([]);
    expect(await titles({ level: "INTERMEDIATE" })).toEqual(["Sales Closing Intensive"]);
    expect(await titles({ price: "free" })).toEqual(["Cold Calling Pro"]);
    expect((await titles({ price: "paid" })).sort()).toEqual(["Sales Closing Intensive", "Support Basics"]);
    expect(await titles({ price: "paid", min: 2000, max: 3000 })).toEqual(["Sales Closing Intensive"]);
    expect(await titles({ price: "paid", min: 2600 })).toEqual([]);
    expect(await titles({ price: "paid", max: 1000 })).toEqual(["Support Basics"]);
    expect(await titles({ preview: true })).toEqual(["Cold Calling Pro"]);
  });

  it("orders by popularity, newest, rating and price", async () => {
    expect((await titles({ sort: "popular" }))[0]).toBe("Cold Calling Pro");
    expect(await titles({ sort: "newest" })).toEqual(["Cold Calling Pro", "Sales Closing Intensive", "Support Basics"]);
    expect((await titles({ sort: "rating" }))[0]).toBe("Cold Calling Pro");
    expect(await titles({ sort: "price-low" })).toEqual(["Cold Calling Pro", "Support Basics", "Sales Closing Intensive"]);
    expect(await titles({ sort: "price-high" })).toEqual(["Sales Closing Intensive", "Support Basics", "Cold Calling Pro"]);
  });

  it("carries counts that follow the access rule, and hides the enrolled number when the Admin chose to", async () => {
    const { cards } = await getCatalog(db, q(), { withFeatured: false });
    const cold = cards.find((c) => c.slug === "cold-calling-pro")!;
    // Paid and waived count; refunded and still-pending do not.
    expect(cold.enrolled).toBe(2);
    expect(cold.ratingCount).toBe(1);
    expect(cold.ratingAverage).toBe(5);
    expect(cold.hasPreview).toBe(true);
    expect(cold.lessonCount).toBe(4);
    expect(cold.minutes).toBe(8);
    expect(cards.find((c) => c.slug === "support-basics")!.enrolled).toBeNull();
    expect(cards.find((c) => c.slug === "sales-closing-intensive")!.hasPreview).toBe(false);
  });

  it("names a coach only when their public page is live", async () => {
    const { cards } = await getCatalog(db, q(), { withFeatured: false });
    expect(cards.find((c) => c.slug === "cold-calling-pro")!.coaches).toEqual([{ name: "Maria Cruz", slug: "maria-cruz" }]);
    expect(cards.find((c) => c.slug === "sales-closing-intensive")!.coaches).toEqual([]);
    expect(cards.find((c) => c.slug === "support-basics")!.coaches).toEqual([]);
  });

  it("shows the featured row only when asked and only on the first page", async () => {
    expect((await getCatalog(db, q(), { withFeatured: true })).featured.map((c) => c.title)).toEqual(["Cold Calling Pro"]);
    expect((await getCatalog(db, q(), { withFeatured: false })).featured).toEqual([]);
  });

  it("lists only categories that have a listed course, and resolves an active category by slug", async () => {
    expect((await getCatalogCategories(db)).map((c) => `${c.slug}:${c.count}`)).toEqual(["sales:2", "support:1"]);
    expect(await getCategory(db, "sales")).toEqual({ name: "Sales", slug: "sales" });
    expect(await getCategory(db, "nope")).toBeNull();
  });

  it("leaks nothing: no email, storage key, cover key, user id or enrolment id anywhere in the catalog", async () => {
    const json = JSON.stringify(await getCatalog(db, q(), { withFeatured: true }));
    for (const forbidden of ["hirewise.example", "talent.example", "thumbnailKey", "storageKey", "courses/support/cover", "lessons/secret", "ownerCoachUserId", ids.coach1, ids.owner, profiles.owner]) expect(json).not.toContain(forbidden);
    // The cover address is the stable public route, never the key.
    expect(JSON.parse(json).cards.find((c: { slug: string }) => c.slug === "support-basics").coverUrl).toMatch(/^\/api\/academy\/thumbnail\/[A-Za-z0-9]+\?v=\d+$/);
  });
});

describe("a course page", () => {
  it("shows the course with a free preview, a locked curriculum, live coaches and visible reviews", async () => {
    const r = await getPublicCoursePage(db, "cold-calling-pro");
    expect(r?.type).toBe("FOUND");
    if (r?.type !== "FOUND") return;
    const c = r.course;
    expect(c.unlisted).toBe(false);
    expect(c.pitch).toBe("Win more calls every day");
    expect(c.enrolled).toBe(2);
    expect(c.ratingAverage).toBe(5);
    expect(c.ratingCount).toBe(1);
    expect(c.coaches).toEqual([{ name: "Maria Cruz", slug: "maria-cruz", headline: "Setter trainer", bio: "Ten years of calls.", photoUrl: null }]);
    expect(c.reviews.map((x) => x.body)).toEqual(["Great course"]);
    expect(c.reviews[0].author).toBe("Maria S.");
    expect(c.curriculum[0].lessons.map((l) => `${l.title}:${l.isFreePreview}`)).toEqual(["Welcome video:true", "The script:false", "Live demo:false", "Final quiz:false"]);
    expect(c.previews.map((p) => p.title)).toEqual(["Welcome video"]);
    expect(c.previews[0]).toMatchObject({ contentType: "VIDEO", hasFile: true, url: null, body: null });
    expect(c.lessonCount).toBe(4);
    expect(c.previewCount).toBe(1);
  });

  it("never carries a gated lesson's body, link or file, nor a draft lesson, nor any key or email", async () => {
    const json = JSON.stringify(await getPublicCoursePage(db, "cold-calling-pro"));
    for (const forbidden of ["SECRET BODY", "SECRETURL", "DRAFT ONLY", "lessons/secret", "storageKey", "hirewise.example", "talent.example", ids.owner, profiles.owner, "Hidden one", "Ana Reyes", "Juan"]) expect(json).not.toContain(forbidden);
  });

  it("serves an unlisted course by its address, marked for noindex, but never a draft or archived one", async () => {
    const gem = await getPublicCoursePage(db, "hidden-gem");
    expect(gem?.type === "FOUND" && gem.course.unlisted).toBe(true);
    expect(await getPublicCoursePage(db, "draft-course")).toBeNull();
    expect(await getPublicCoursePage(db, "old-course")).toBeNull();
    expect(await getPublicCoursePage(db, "no-such-course")).toBeNull();
  });

  it("an unlisted coach with no listed course is not named on the course page", async () => {
    const gem = await getPublicCoursePage(db, "hidden-gem");
    expect(gem?.type === "FOUND" && gem.course.coaches).toEqual([]);
  });

  it("a retired address answers with the current one", async () => {
    await savePublicDetails(db, coach2(), course.closing, { slug: "closing-intensive" });
    expect(await getPublicCoursePage(db, "sales-closing-intensive")).toEqual({ type: "REDIRECT", slug: "closing-intensive" });
    const now = await getPublicCoursePage(db, "closing-intensive");
    expect(now?.type).toBe("FOUND");
    expect(await publicSlugForCourseId(db, course.closing)).toBe("closing-intensive");
    expect(await publicSlugForCourseId(db, course.draft)).toBeNull();
    expect(await publicSlugForCourseId(db, "missing")).toBeNull();
  });

  it("lists related courses from the same category, never itself or an unlisted course", async () => {
    const r = await getPublicCoursePage(db, "cold-calling-pro");
    expect(r?.type === "FOUND" && r.course.related.map((c) => c.title)).toEqual(["Sales Closing Intensive"]);
  });
});

describe("a coach page", () => {
  it("shows a public coach with their listed courses, learners and rating", async () => {
    const r = await getPublicCoachPage(db, "maria-cruz");
    expect(r?.type).toBe("FOUND");
    if (r?.type !== "FOUND") return;
    expect(r.coach.displayName).toBe("Maria Cruz");
    expect(r.coach.courses.map((c) => c.title)).toEqual(["Cold Calling Pro"]);
    expect(r.coach.students).toBe(2);
    expect(r.coach.ratingCount).toBe(1);
    expect(r.coach.links).toEqual([{ label: "LinkedIn", url: "https://linkedin.com/in/maria" }]);
    const json = JSON.stringify(r);
    for (const forbidden of ["hirewise.example", "photoKey", ids.coach1, "Hidden Gem", "Draft Course"]) expect(json).not.toContain(forbidden);
  });

  it("answers nothing for a coach whose page is off, or who has no listed course", async () => {
    expect(await getPublicCoachPage(db, "hank-hidden")).toBeNull();
    expect(await getPublicCoachPage(db, "una-unlisted")).toBeNull();
    expect(await getPublicCoachPage(db, "nobody")).toBeNull();
  });

  it("a retired coach address redirects to the current one", async () => {
    await saveOwnCoachProfile(db, coach1(), { displayName: "Maria Cruz", headline: "Setter trainer", bio: "Ten years of calls.", slug: "coach-maria", links: [], isPublic: true });
    expect(await getPublicCoachPage(db, "maria-cruz")).toEqual({ type: "REDIRECT", slug: "coach-maria" });
    expect((await getPublicCoachPage(db, "coach-maria"))?.type).toBe("FOUND");
  });
});

describe("the sitemap", () => {
  it("lists listed courses, categories with courses and live coaches, and nothing else", async () => {
    const paths = (await sitemapEntries(db)).map((e) => e.path).sort();
    expect(paths).toEqual(["/academy/category/sales", "/academy/category/support", "/academy/closing-intensive", "/academy/cold-calling-pro", "/academy/support-basics", "/coaches/coach-maria"]);
  });
});

describe("what the visitor sees", () => {
  it("tells signed-out visitors, buyers, owners, pending and ended apart", async () => {
    expect((await getCourseViewer(db, null, course.cold)).state).toBe("SIGNED_OUT");
    expect((await getCourseViewer(db, learner("stranger"), course.cold)).state).toBe("CAN_BUY");
    expect((await getCourseViewer(db, learner("owner"), course.cold)).state).toBe("OWNER");
    expect((await getCourseViewer(db, learner("pending"), course.cold)).state).toBe("PENDING");
    expect((await getCourseViewer(db, learner("refunded"), course.cold)).state).toBe("ENDED");
    expect((await getCourseViewer(db, client(), course.cold)).state).toBe("NOT_TALENT");
  });

  it("gives an owner their own review and no one else's", async () => {
    expect((await getCourseViewer(db, learner("owner"), course.cold)).myReview).toEqual({ rating: 5, body: "Great course" });
    expect((await getCourseViewer(db, learner("second"), course.cold)).myReview).toEqual({ rating: 3, body: "Hidden one" });
    expect((await getCourseViewer(db, learner("stranger"), course.cold)).myReview).toBeNull();
  });

  it("offers a personal share link only to members who can refer", async () => {
    expect((await getCourseViewer(db, null, course.cold)).canShare).toBe(false);
    expect((await getCourseViewer(db, client(), course.cold)).canShare).toBe(false);
    expect((await getCourseViewer(db, learner("owner"), course.cold)).canShare).toBe(true);
  });

  it("does not answer for a draft, archived or unknown course", async () => {
    for (const id of [course.draft, course.old, "missing"]) await expect(getCourseViewer(db, learner("owner"), id)).rejects.toThrow(NotFoundError);
  });
});

describe("share links", () => {
  it("gives a member the page address with their own code, the same code every time", async () => {
    const a = await shareLinkFor(db, learner("owner"), "/academy/cold-calling-pro");
    const b = await shareLinkFor(db, learner("owner"), "/coaches/coach-maria");
    const code = (await db.user.findUniqueOrThrow({ where: { id: ids.owner } })).referralCode!;
    expect(a).toBe(`http://localhost:3000/academy/cold-calling-pro?ref=${encodeURIComponent(code)}`);
    expect(b).toBe(`http://localhost:3000/coaches/coach-maria?ref=${encodeURIComponent(code)}`);
  });

  it("refuses clients, and any address that is not a public Academy page", async () => {
    await expect(shareLinkFor(db, client(), "/academy/cold-calling-pro")).rejects.toThrow(ForbiddenError);
    for (const bad of ["/staff/academy", "//evil.example", "https://evil.example", "/academy/../staff", "/academy/x?ref=ABC", "/academy/a/b/c", "/", "/join"]) {
      expect(isShareablePath(bad)).toBe(false);
      await expect(shareLinkFor(db, learner("owner"), bad)).rejects.toThrow(NotFoundError);
    }
    for (const good of ["/academy", "/academy/cold-calling-pro", "/academy/category/sales", "/coaches/coach-maria"]) expect(isShareablePath(good)).toBe(true);
  });
});

describe("images", () => {
  it("a published course has a public cover key; a draft or unknown one has none", async () => {
    expect(await publicCoverKey(db, course.support)).toBe("courses/support/cover/a.png");
    expect(await publicCoverKey(db, course.cold)).toBeNull();
    await db.academyCourse.update({ where: { id: course.draft }, data: { thumbnailKey: "courses/draft/cover/a.png" } });
    expect(await publicCoverKey(db, course.draft)).toBeNull();
    expect(await publicCoverKey(db, "missing")).toBeNull();
  });

  it("a coach adds a photo in two steps, only to their own profile and only after saving a profile", async () => {
    resetRateLimits();
    const nobody = makeActor("COACH", { userId: ids.coach3 });
    await expect(createCoachPhotoUploadUrl(db, nobody, { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(/Save your profile first/);
    await expect(createCoachPhotoUploadUrl(db, learner("owner"), { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(ForbiddenError);
    await expect(createCoachPhotoUploadUrl(db, coach1(), { contentType: "image/gif", sizeBytes: 1000 })).rejects.toThrow(/PNG, JPG, or WebP/);
    await expect(createCoachPhotoUploadUrl(db, coach1(), { contentType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 })).rejects.toThrow(/too large/);

    const req = await createCoachPhotoUploadUrl(db, coach1(), { contentType: "image/png", sizeBytes: png.length });
    const profile = await db.coachProfile.findUniqueOrThrow({ where: { userId: ids.coach1 } });
    expect(req.key.startsWith(`coaches/${profile.id}/photo/`)).toBe(true);
    await expect(setCoachPhoto(db, coach1(), req.key)).rejects.toThrow(/Upload the photo/);
    await getStorage().put(req.key, png, "image/png");
    const saved = await setCoachPhoto(db, coach1(), req.key);
    expect(saved.hasPhoto).toBe(true);
    expect(saved.photoUrl).toMatch(/^\/api\/coach-photo\/coach-maria\?v=\d+$/);
    expect(JSON.stringify(saved)).not.toContain(req.key);

    // Another coach cannot attach that file to their profile.
    await expect(setCoachPhoto(db, coach2(), req.key)).rejects.toThrow(/does not belong/);

    // The public page now carries the photo address, not the key.
    const page = await getPublicCoachPage(db, "coach-maria");
    expect(page?.type === "FOUND" && page.coach.photoUrl).toMatch(/^\/api\/coach-photo\/coach-maria/);
    expect(JSON.stringify(page)).not.toContain(req.key);

    expect(await coachPhotoAccess(db, "coach-maria")).toEqual({ key: req.key, ownerUserId: ids.coach1, live: true });
    expect(await coachPhotoAccess(db, "hank-hidden")).toBeNull();

    // Replacing removes the old file; clearing removes the photo.
    const req2 = await createCoachPhotoUploadUrl(db, coach1(), { contentType: "image/png", sizeBytes: png.length });
    await getStorage().put(req2.key, png, "image/png");
    await setCoachPhoto(db, coach1(), req2.key);
    expect(await getStorage().exists(req.key)).toBe(false);
    await setCoachPhoto(db, coach1(), null);
    expect(await getStorage().exists(req2.key)).toBe(false);
    expect(await coachPhotoAccess(db, "coach-maria")).toBeNull();
  });

  it("a photo of a coach whose page is off is not live", async () => {
    resetRateLimits();
    const req = await createCoachPhotoUploadUrl(db, coach2(), { contentType: "image/png", sizeBytes: png.length });
    await getStorage().put(req.key, png, "image/png");
    await setCoachPhoto(db, coach2(), req.key);
    expect(await coachPhotoAccess(db, "hank-hidden")).toMatchObject({ live: false, ownerUserId: ids.coach2 });
  });
});

describe("paging", () => {
  it("shows 12 courses a page and clamps a page past the end", async () => {
    for (let i = 1; i <= 13; i++) await mkCourse({ key: `bulk${i}`, title: `Bulk Course ${String(i).padStart(2, "0")}`, slug: `bulk-course-${i}`, owner: "coach1" });
    const first = await getCatalog(db, q({ sort: "newest" }), { withFeatured: false });
    expect(first.total).toBe(16);
    expect(first.pages).toBe(2);
    expect(first.cards).toHaveLength(12);
    const second = await getCatalog(db, q({ sort: "newest", page: 2 }), { withFeatured: false });
    expect(second.cards).toHaveLength(4);
    const beyond = await getCatalog(db, q({ sort: "newest", page: 99 }), { withFeatured: false });
    expect(beyond.page).toBe(2);
    expect(beyond.cards).toHaveLength(4);
    // No course appears on two pages.
    expect(new Set([...first.cards, ...second.cards].map((c) => c.id)).size).toBe(16);
  });
});
