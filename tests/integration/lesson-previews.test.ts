import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { testDb, resetDb } from "../setup/db";
import { canWatchLesson, assertCanWatchLesson, assertLearnerOwnsLesson, LessonAccessError } from "@/server/policies/lesson-access";
import { createLessonUploadUrl, lessonDownloadUrl, recordCourseRefund, reorderLessons, saveLesson, courseWarnings, getEnrollmentForAgent } from "@/server/services/academy.service";
import { getPublicCourse } from "@/server/services/course-public.service";
import { startLesson } from "@/server/services/lesson-media.service";
import { ensureReferralCode } from "@/server/services/referral.service";
import { recalculateAllForCourse } from "@/server/services/progress.service";
import { POST as captureReferral } from "@/app/api/referral/capture/route";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { getStorage } from "@/server/adapters/storage";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";

const db = testDb();
const ids = { admin: "admin_lp", sales: "sales_lp", coach: "coach_lp", outsideCoach: "coach2_lp", course: "", mod: "", draftMod: "", pending: "", owner: "", waived: "", other: "", nonOwner: "", refunded: "" };
const L = { welcome: "", gated1: "", gated2: "", doc: "", draft: "", draftPreview: "", inDraftModule: "", legacyHosted: "", quiz: "" };
const profiles: Record<string, string> = {};

const visitor = null;
const learner = (key: "owner" | "waived" | "other" | "nonOwner" | "pending" | "refunded") => makeActor("AGENT", { userId: ids[key], agentProfileId: profiles[key] });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach = () => makeActor("COACH", { userId: ids.coach });
const outsideCoach = () => makeActor("COACH", { userId: ids.outsideCoach });

async function mkUser(key: keyof typeof ids, email: string, role: RoleKey) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}
const enrol = (key: string, paymentStatus: "PAID" | "WAIVED" | "NOT_REQUIRED" | "PENDING") => db.courseEnrollment.create({ data: { courseId: ids.course, agentProfileId: profiles[key], priceCents: 100_000, currency: "PHP", paymentStatus, paidCents: paymentStatus === "PAID" ? 100_000 : null, paidAt: paymentStatus === "PAID" ? new Date() : null } });
const lesson = (moduleId: string, order: number, title: string, over: Record<string, unknown> = {}) => db.courseLesson.create({ data: { moduleId, order, title, contentType: "VIDEO", storageKey: `lessons/${ids.course}/${title.replace(/\s/g, "-")}.mp4`, fileName: `${title}.mp4`, durationSec: 120, status: "PUBLISHED", isFreePreview: false, ...over } }).then((l) => l.id);
const urlOf = (u: string) => new URL(u);

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  await resetDb(db);
  resetRateLimits();
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("sales", "sales@hirewise.example", "SALES");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  await mkUser("outsideCoach", "coach2@hirewise.example", "COACH");
  for (const k of ["owner", "waived", "other", "nonOwner", "pending", "refunded"] as const) await mkUser(k, `${k}@talent.example`, "AGENT");

  const c = await db.academyCourse.create({ data: { code: "LP-COURSE", title: "Cold Calling Masterclass", category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents: 100_000, currency: "PHP", ownerCoachUserId: ids.coach } });
  ids.course = c.id;
  ids.mod = (await db.courseModule.create({ data: { courseId: c.id, order: 1, title: "Module 1", status: "PUBLISHED" } })).id;
  ids.draftMod = (await db.courseModule.create({ data: { courseId: c.id, order: 2, title: "Draft module", status: "DRAFT" } })).id;
  L.welcome = await lesson(ids.mod, 1, "Welcome", { isFreePreview: true, isRequired: false });
  L.gated1 = await lesson(ids.mod, 2, "Openers");
  L.gated2 = await lesson(ids.mod, 3, "Objections");
  L.doc = await lesson(ids.mod, 4, "Script", { contentType: "DOCUMENT", storageKey: `lessons/${c.id}/script.pdf`, durationSec: null });
  L.draft = await lesson(ids.mod, 5, "Draft lesson", { status: "DRAFT" });
  L.draftPreview = await lesson(ids.mod, 6, "Draft preview", { status: "DRAFT", isFreePreview: true });
  L.inDraftModule = await lesson(ids.draftMod, 1, "In a draft module", { isFreePreview: true });
  L.legacyHosted = await lesson(ids.mod, 7, "Legacy hosted", { storageKey: null, url: "https://www.youtube.com/watch?v=SECRETLEGACY" });
  L.quiz = await lesson(ids.mod, 8, "Final quiz", { contentType: "QUIZ", storageKey: null, durationSec: null });

  await enrol("owner", "PAID");
  await enrol("waived", "WAIVED");
  await enrol("pending", "PENDING");
  await enrol("refunded", "PAID");
});

afterAll(async () => {
  resetEnvCache();
  await db.$disconnect();
});

describe("a free preview", () => {
  it("is watchable by a logged-out visitor, and a gated lesson is refused with 401", async () => {
    expect(await canWatchLesson(db, visitor, L.welcome)).toBe(true);
    const url = await lessonDownloadUrl(db, visitor, L.welcome);
    expect(urlOf(url).pathname).toContain("/api/storage/");
    await expect(lessonDownloadUrl(db, visitor, L.gated1)).rejects.toMatchObject({ name: "LessonAccessError", status: 401, denial: "SIGN_IN" });
    expect(await canWatchLesson(db, visitor, L.gated1)).toBe(false);
    expect(await canWatchLesson(db, visitor, L.doc)).toBe(false);
  });

  it("a logged-in non-owner (no enrolment, or payment still pending) is refused a gated lesson with 403 but can watch the preview", async () => {
    for (const who of [learner("nonOwner"), learner("pending")]) {
      expect(await canWatchLesson(db, who, L.welcome)).toBe(true);
      await expect(lessonDownloadUrl(db, who, L.gated1)).rejects.toMatchObject({ name: "LessonAccessError", status: 403, denial: "NO_ACCESS" });
      await expect(lessonDownloadUrl(db, who, L.doc)).rejects.toBeInstanceOf(LessonAccessError);
    }
    // Other roles that do not manage the course are in the same position.
    await expect(lessonDownloadUrl(db, sales(), L.gated1)).rejects.toBeInstanceOf(LessonAccessError);
    await expect(lessonDownloadUrl(db, outsideCoach(), L.gated1)).rejects.toBeInstanceOf(LessonAccessError);
  });

  it("an unknown lesson is NotFound", async () => {
    await expect(lessonDownloadUrl(db, visitor, "nope")).rejects.toBeInstanceOf(NotFoundError);
    expect(await canWatchLesson(db, visitor, "nope")).toBe(false);
  });
});

describe("owners", () => {
  it("an owner (paid or waived) watches every published lesson", async () => {
    for (const who of [learner("owner"), learner("waived")]) {
      for (const id of [L.welcome, L.gated1, L.gated2, L.doc]) {
        expect(await canWatchLesson(db, who, id), id).toBe(true);
        await expect(lessonDownloadUrl(db, who, id)).resolves.toContain("/api/storage/");
      }
    }
  });

  it("a refund removes access to gated lessons immediately, and the preview stays open", async () => {
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.course, agentProfileId: profiles.refunded } });
    expect(await canWatchLesson(db, learner("refunded"), L.gated1)).toBe(true);
    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "Changed their mind" });
    expect(await canWatchLesson(db, learner("refunded"), L.gated1)).toBe(false);
    await expect(lessonDownloadUrl(db, learner("refunded"), L.gated1)).rejects.toBeInstanceOf(LessonAccessError);
    expect(await canWatchLesson(db, learner("refunded"), L.welcome)).toBe(true);
    // A chargeback is the same.
    const e2 = await db.courseEnrollment.create({ data: { courseId: ids.course, agentProfileId: profiles.other, priceCents: 100_000, currency: "PHP", paymentStatus: "PAID", paidCents: 100_000, paidAt: new Date() } });
    expect(await canWatchLesson(db, learner("other"), L.gated2)).toBe(true);
    await recordCourseRefund(db, admin(), e2.id, { kind: "CHARGEBACK", reason: "Card dispute" });
    expect(await canWatchLesson(db, learner("other"), L.gated2)).toBe(false);
  });

  it("a revoked enrolment (agency exit) loses access too", async () => {
    await db.courseEnrollment.updateMany({ where: { courseId: ids.course, agentProfileId: profiles.waived }, data: { accessRevokedAt: new Date(), status: "REVOKED" } });
    expect(await canWatchLesson(db, learner("waived"), L.gated1)).toBe(false);
    await db.courseEnrollment.updateMany({ where: { courseId: ids.course, agentProfileId: profiles.waived }, data: { accessRevokedAt: null, status: "ENROLLED" } });
    expect(await canWatchLesson(db, learner("waived"), L.gated1)).toBe(true);
  });

  it("a free course enrolment counts as owning it", async () => {
    const free = await db.academyCourse.create({ data: { code: "LP-FREE", title: "Free course", category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents: 0, currency: "PHP", ownerCoachUserId: ids.coach } });
    const m = await db.courseModule.create({ data: { courseId: free.id, order: 1, title: "M", status: "PUBLISHED" } });
    const l = await db.courseLesson.create({ data: { moduleId: m.id, order: 1, title: "Gated in free", contentType: "VIDEO", storageKey: "lessons/free/a.mp4", status: "PUBLISHED" } });
    expect(await canWatchLesson(db, learner("nonOwner"), l.id)).toBe(false);
    await db.courseEnrollment.create({ data: { courseId: free.id, agentProfileId: profiles.nonOwner, priceCents: 0, currency: "PHP", paymentStatus: "NOT_REQUIRED" } });
    expect(await canWatchLesson(db, learner("nonOwner"), l.id)).toBe(true);
  });
});

describe("unpublished lessons", () => {
  const hidden = () => [L.draft, L.draftPreview, L.inDraftModule];

  it("are hidden from every viewer except staff who manage the course", async () => {
    for (const who of [visitor, learner("nonOwner"), learner("pending"), learner("owner"), learner("waived"), sales(), outsideCoach()]) {
      for (const id of hidden()) {
        expect(await canWatchLesson(db, who, id), `${who?.role ?? "visitor"} ${id}`).toBe(false);
        await expect(assertCanWatchLesson(db, who, id)).rejects.toBeInstanceOf(NotFoundError); // 404, not 401 or 403
      }
    }
    for (const who of [admin(), coach()]) for (const id of hidden()) expect(await canWatchLesson(db, who, id), `${who.role} ${id}`).toBe(true);
  });

  it("a preview in a course that is not published is not public, and the public page 404s", async () => {
    await db.academyCourse.update({ where: { id: ids.course }, data: { status: "ARCHIVED" } });
    expect(await canWatchLesson(db, visitor, L.welcome)).toBe(false);
    expect(await canWatchLesson(db, learner("owner"), L.gated1)).toBe(true); // owners keep what they bought
    await expect(getPublicCourse(db, visitor, ids.course)).rejects.toBeInstanceOf(NotFoundError);
    await db.academyCourse.update({ where: { id: ids.course }, data: { status: "PUBLISHED" } });
  });

  it("the public page lists published lessons only", async () => {
    const c = await getPublicCourse(db, visitor, ids.course);
    const titles = c.curriculum.flatMap((m) => m.lessons.map((l) => l.title));
    expect(titles).toEqual(expect.arrayContaining(["Welcome", "Openers", "Objections", "Script"]));
    for (const hiddenTitle of ["Draft lesson", "Draft preview", "In a draft module", "Draft module"]) expect(JSON.stringify(c)).not.toContain(hiddenTitle);
  });
});

describe("no raw video address for gated lessons", () => {
  it("the public page and the not-owner course view carry no source, link, body, or storage key for a gated lesson", async () => {
    const pub = await getPublicCourse(db, visitor, ids.course);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("lessons/");
    expect(json).not.toContain("/api/storage");
    expect(json).not.toContain("SECRETLEGACY"); // a legacy gated hosted link
    // Gated lessons appear as outline entries only.
    for (const m of pub.curriculum) for (const l of m.lessons) expect(Object.keys(l).sort()).toEqual(["contentType", "durationSec", "id", "isFreePreview", "title"]);
    // Only the preview lesson is playable here, and only through our route (the page builds that from its id).
    const playable = pub.previewModules.flatMap((m) => m.lessons);
    expect(playable.map((l) => l.id)).toEqual([L.welcome]);
    expect(JSON.stringify(playable)).not.toContain("lessons/");

    for (const who of [learner("nonOwner"), learner("pending")]) {
      const view = await getEnrollmentForAgent(db, who, ids.course);
      expect(view.course.modules).toBeNull();
      const j = JSON.stringify(view.course);
      expect(j).not.toContain("SECRETLEGACY");
      expect(j).not.toContain("lessons/");
      expect(j).not.toContain("/api/storage");
    }
  });

  it("even for owners, the view carries a boolean for the file, never the key or a bucket address", async () => {
    const view = await getEnrollmentForAgent(db, learner("owner"), ids.course);
    const j = JSON.stringify(view.course.modules);
    expect(j).not.toContain("storageKey");
    expect(j).not.toContain("lessons/");
    expect(j).not.toContain("/api/storage");
  });

  it("signed links expire: two hours for video, ten minutes for other files, never permanent", async () => {
    const now = Date.now();
    const video = urlOf(await lessonDownloadUrl(db, learner("owner"), L.gated1));
    const doc = urlOf(await lessonDownloadUrl(db, learner("owner"), L.doc));
    const preview = urlOf(await lessonDownloadUrl(db, visitor, L.welcome));
    const ttl = (u: URL) => Math.round((Number(u.searchParams.get("exp")) - now) / 1000);
    expect(ttl(video)).toBeGreaterThan(7100);
    expect(ttl(video)).toBeLessThanOrEqual(7210);
    expect(ttl(doc)).toBeGreaterThan(500);
    expect(ttl(doc)).toBeLessThanOrEqual(610);
    expect(ttl(preview)).toBeLessThanOrEqual(7210); // the preview bucket object is private too
    expect(video.searchParams.get("sig")).toBeTruthy();
  });

  it("the lesson video TTL is a setting, between a minute and a day", async () => {
    process.env.LESSON_VIDEO_URL_TTL_SECONDS = "3600";
    resetEnvCache();
    const u = urlOf(await lessonDownloadUrl(db, learner("owner"), L.gated1));
    expect(Math.round((Number(u.searchParams.get("exp")) - Date.now()) / 1000)).toBeLessThanOrEqual(3610);
    process.env.LESSON_VIDEO_URL_TTL_SECONDS = "7200";
    resetEnvCache();
  });
});

describe("reordering never changes access", () => {
  it("moving lessons around leaves every lesson's access exactly as it was", async () => {
    const lessons = [L.welcome, L.gated1, L.gated2, L.doc, L.draft, L.draftPreview, L.legacyHosted, L.quiz];
    const who = [visitor, learner("nonOwner"), learner("owner"), admin()];
    const snapshot = async () => Promise.all(who.flatMap((w) => lessons.map(async (id) => `${w?.role ?? "visitor"}:${id}:${await canWatchLesson(db, w, id)}`)));
    const before = await snapshot();
    const current = (await db.courseLesson.findMany({ where: { moduleId: ids.mod }, orderBy: { order: "asc" }, select: { id: true } })).map((l) => l.id);
    // Put the preview last and a gated lesson first.
    const reordered = [...current.filter((id) => id !== L.welcome), L.welcome];
    await reorderLessons(db, admin(), ids.course, ids.mod, reordered);
    expect((await db.courseLesson.findMany({ where: { moduleId: ids.mod }, orderBy: { order: "asc" }, select: { id: true } })).map((l) => l.id)).toEqual(reordered);
    expect(await snapshot()).toEqual(before);
    // And the flag itself is untouched by order.
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: L.welcome } })).isFreePreview).toBe(true);
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: L.gated1 } })).isFreePreview).toBe(false);
    await reorderLessons(db, admin(), ids.course, ids.mod, current);
  });

  it("refuses a list that is not exactly the module's lessons, and anyone who cannot edit the course", async () => {
    const current = (await db.courseLesson.findMany({ where: { moduleId: ids.mod }, orderBy: { order: "asc" }, select: { id: true } })).map((l) => l.id);
    await expect(reorderLessons(db, admin(), ids.course, ids.mod, current.slice(1))).rejects.toThrow(/changed/);
    await expect(reorderLessons(db, admin(), ids.course, ids.mod, [...current.slice(1), current[1]])).rejects.toThrow(/changed/);
    await expect(reorderLessons(db, admin(), ids.course, ids.mod, [...current.slice(1), "foreign"])).rejects.toThrow(/changed/);
    await expect(reorderLessons(db, sales(), ids.course, ids.mod, current)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reorderLessons(db, outsideCoach(), ids.course, ids.mod, current)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderLessons(db, learner("owner"), ids.course, ids.mod, current)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tracking progress", () => {
  it("only an owner can track a lesson; a preview can be watched but not tracked by a non-owner", async () => {
    await expect(startLesson(db, learner("nonOwner"), L.welcome)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startLesson(db, learner("pending"), L.welcome)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startLesson(db, learner("owner"), L.draft)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startLesson(db, learner("owner"), L.welcome)).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await expect(assertLearnerOwnsLesson(db, learner("owner"), L.gated1)).resolves.toBeUndefined();
  });
});

describe("saving lessons", () => {
  const base = { moduleId: "", title: "A new lesson", contentType: "VIDEO" as const, isRequired: true, status: "PUBLISHED" as const };

  it("a new lesson is gated unless it is marked as a free preview", async () => {
    const id = await saveLesson(db, admin(), ids.course, { ...base, moduleId: ids.mod, storageKey: undefined, url: "" , contentType: "TEXT", body: "Hello" });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id } })).isFreePreview).toBe(false);
  });

  it("a free preview video must be an uploaded file; other videos may be YouTube, Vimeo, or Loom links", async () => {
    await expect(saveLesson(db, admin(), ids.course, { ...base, moduleId: ids.mod, url: "https://www.youtube.com/watch?v=abc", isFreePreview: true })).rejects.toThrow(/free preview video must be uploaded/);
    // A gated lesson may link out.
    const gated = await saveLesson(db, admin(), ids.course, { ...base, moduleId: ids.mod, url: "https://www.youtube.com/watch?v=abc" });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: gated } })).url).toBe("https://www.youtube.com/watch?v=abc");
    expect(await canWatchLesson(db, visitor, gated)).toBe(false);
    // An uploaded preview works, and anyone can watch it.
    const { key } = await createLessonUploadUrl(db, admin(), ids.course, { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 10 });
    await getStorage().put(key, Buffer.from("x"), "video/mp4");
    const preview = await saveLesson(db, admin(), ids.course, { ...base, moduleId: ids.mod, title: "Welcome upload", storageKey: key, fileName: "w.mp4", contentMime: "video/mp4", sizeBytes: 1, isFreePreview: true });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: preview } })).isFreePreview).toBe(true);
    expect(await canWatchLesson(db, visitor, preview)).toBe(true);
    // Switching an existing hosted-link lesson to a free preview is refused until it is uploaded.
    await expect(saveLesson(db, admin(), ids.course, { ...base, id: gated, moduleId: ids.mod, url: "https://www.youtube.com/watch?v=abc", isFreePreview: true })).rejects.toThrow(/free preview video must be uploaded/);
  });

  it("quizzes, assignments, and assessments cannot be free previews", async () => {
    for (const contentType of ["QUIZ", "ASSIGNMENT", "ASSESSMENT"] as const) {
      await expect(saveLesson(db, admin(), ids.course, { ...base, moduleId: ids.mod, contentType, isFreePreview: true, passingScore: 70, ...(contentType === "ASSIGNMENT" ? { submissionType: "TEXT" as const } : {}) })).rejects.toThrow(/cannot be free previews/);
    }
  });

  it("only staff who manage the course can change who may watch a lesson", async () => {
    await expect(saveLesson(db, sales(), ids.course, { ...base, moduleId: ids.mod, contentType: "TEXT", body: "x", isFreePreview: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveLesson(db, outsideCoach(), ids.course, { ...base, moduleId: ids.mod, contentType: "TEXT", body: "x", isFreePreview: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveLesson(db, learner("owner"), ids.course, { ...base, moduleId: ids.mod, contentType: "TEXT", body: "x", isFreePreview: true })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the admin warning", () => {
  const lessonsOf = (over: { status?: string; isFreePreview?: boolean }[]) => [{ status: "PUBLISHED", lessons: over.map((o) => ({ status: o.status ?? "PUBLISHED", isFreePreview: !!o.isFreePreview })) }];
  it("warns when a course has no published free-preview lesson, and never blocks", () => {
    expect(courseWarnings({ status: "PUBLISHED", modules: lessonsOf([{}, {}]) })[0]).toMatch(/no free-preview lesson/);
    expect(courseWarnings({ status: "DRAFT", modules: lessonsOf([{}]) })[0]).toMatch(/before this course goes live/);
    expect(courseWarnings({ status: "PUBLISHED", modules: lessonsOf([{}, { isFreePreview: true }]) })).toEqual([]);
    expect(courseWarnings({ status: "PUBLISHED", modules: lessonsOf([{ isFreePreview: true, status: "DRAFT" }]) })).toHaveLength(1); // an unpublished preview does not count
    expect(courseWarnings({ status: "ARCHIVED", modules: [] })).toEqual([]);
    // A welcome preview that is still an external link is flagged; an uploaded one, or a gated link, is not.
    const video = (over: Record<string, unknown>) => [{ status: "PUBLISHED", lessons: [{ status: "PUBLISHED", isFreePreview: true, title: "Welcome", contentType: "VIDEO", storageKey: null, url: null, ...over }] }];
    expect(courseWarnings({ status: "PUBLISHED", modules: video({ url: "https://youtu.be/x" }) }).join(" ")).toMatch(/"Welcome" is an external link/);
    expect(courseWarnings({ status: "PUBLISHED", modules: video({ storageKey: "lessons/c/w.mp4" }) })).toEqual([]);
    expect(courseWarnings({ status: "PUBLISHED", modules: [...video({ storageKey: "k" }), { status: "PUBLISHED", lessons: [{ status: "PUBLISHED", isFreePreview: false, contentType: "VIDEO", url: "https://youtu.be/y" }] }] })).toEqual([]);
  });
});

describe("referral links on a course page", () => {
  const post = (body: unknown) => captureReferral(new NextRequest("http://localhost:3000/api/referral/capture", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify(body) }));

  it("?ref=CODE posted from the course page logs the click and sets the same referral cookie as /join", async () => {
    const code = await ensureReferralCode(db, ids.owner);
    const before = await db.referralClick.count();
    const res = await post({ ref: code.toLowerCase(), path: `/academy/courses/${ids.course}` });
    expect(res.status).toBe(204);
    expect(res.cookies.get("hw_ref")?.value).toBe(code);
    expect(await db.referralClick.count()).toBe(before + 1);
    expect((await db.referralClick.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).landingUrl).toBe(`/academy/courses/${ids.course}`);
  });

  it("an unknown code, no code, a bad body, or an off-site path does nothing and never fails", async () => {
    for (const body of [{ ref: "NOPE-000000" }, {}, { ref: 5 }, "garbage"]) {
      const res = await post(body);
      expect(res.status).toBe(204);
      expect(res.cookies.get("hw_ref")).toBeUndefined();
    }
    const code = await ensureReferralCode(db, ids.owner);
    await post({ ref: code, path: "//evil.example/x" });
    expect((await db.referralClick.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).landingUrl).toBe("/");
  });

  it("the public page sends the ref code to the capture route", () => {
    const page = readFileSync(join(__dirname, "..", "..", "src", "app", "(marketing)", "academy", "courses", "[courseId]", "page.tsx"), "utf8");
    expect(page).toContain("ReferralCapture");
    const component = readFileSync(join(__dirname, "..", "..", "src", "components", "marketing", "ReferralCapture.tsx"), "utf8");
    expect(component).toContain("/api/referral/capture");
    expect(component).toContain('get("ref")');
  });
});

describe("the welcome-video migration", () => {
  it("turns a course's intro video into a first, free-preview lesson that is not required, and runs safely twice", async () => {
    const sql = readFileSync(join(__dirname, "..", "..", "prisma", "migrations", "20261027100000_lesson_free_preview", "migration.sql"), "utf8");
    const code = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
    const inserts = code.split(";").map((s) => s.trim()).filter((s) => s.startsWith("INSERT INTO"));
    expect(inserts).toHaveLength(2);

    const c = await db.academyCourse.create({ data: { code: "LP-INTRO", title: "Intro course", category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents: 50_000, currency: "PHP", ownerCoachUserId: ids.coach, introVideoUrl: "https://www.youtube.com/watch?v=INTROVID" } });
    const none = await db.academyCourse.create({ data: { code: "LP-NOINTRO", title: "No intro", category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents: 50_000, currency: "PHP", ownerCoachUserId: ids.coach } });
    const m1 = await db.courseModule.create({ data: { courseId: c.id, order: 1, title: "Existing", status: "PUBLISHED", isRequired: true } });
    const req = await db.courseLesson.create({ data: { moduleId: m1.id, order: 1, title: "Required text", contentType: "TEXT", body: "x", isRequired: true, status: "PUBLISHED" } });
    const learnerEnrol = await db.courseEnrollment.create({ data: { courseId: c.id, agentProfileId: profiles.owner, priceCents: 50_000, currency: "PHP", paymentStatus: "PAID", paidCents: 50_000 } });
    await db.lessonProgress.create({ data: { lessonId: req.id, agentProfileId: profiles.owner, status: "COMPLETED", completedAt: new Date() } });
    await recalculateAllForCourse(db, c.id);
    const percentBefore = (await db.courseProgress.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: c.id, agentProfileId: profiles.owner } } })).percent;
    expect(percentBefore).toBe(100);

    for (let i = 0; i < 2; i++) for (const stmt of inserts) await db.$executeRawUnsafe(stmt);

    const mods = await db.courseModule.findMany({ where: { courseId: c.id }, orderBy: { order: "asc" }, include: { lessons: true } });
    expect(mods).toHaveLength(2);
    const [welcome, existing] = mods;
    expect(welcome).toMatchObject({ title: "Welcome", isRequired: false, status: "PUBLISHED" });
    expect(welcome.order).toBeLessThan(existing.order); // it is first
    expect(welcome.lessons).toHaveLength(1);
    expect(welcome.lessons[0]).toMatchObject({ contentType: "VIDEO", url: "https://www.youtube.com/watch?v=INTROVID", isFreePreview: true, isRequired: false, status: "PUBLISHED" });
    expect(await db.courseModule.count({ where: { courseId: none.id } })).toBe(0); // no intro, no lesson
    expect(await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ introVideoUrl: "https://www.youtube.com/watch?v=INTROVID" }); // kept

    // Existing learners are untouched: same completion, same enrolment, and the new lesson is watchable by anyone.
    await recalculateAllForCourse(db, c.id);
    expect((await db.courseProgress.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: c.id, agentProfileId: profiles.owner } } })).percent).toBe(100);
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: learnerEnrol.id } })).paymentStatus).toBe("PAID");
    expect(await canWatchLesson(db, visitor, welcome.lessons[0].id)).toBe(true);
    expect(await canWatchLesson(db, visitor, req.id)).toBe(false);
  });
});
