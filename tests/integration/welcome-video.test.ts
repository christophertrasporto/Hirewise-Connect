import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, publishCourse, submitCourseForApproval, publishOwnCourse, archiveCourse, restoreCourse, listAllCoursesForStaff } from "@/server/services/academy.service";
import { setSetting } from "@/server/services/setting.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { UserMessageError } from "@/server/policies/user-message-error";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { hasWelcomeVideo, welcomeVideoProblem } from "@/lib/welcome-video";

const db = testDb();
const ids: Record<string, string> = {};
let categoryId = "";

const coach = () => makeActor("COACH", { userId: ids.coach });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const owner = () => makeActor("SUPER_ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });

async function mkUser(key: string, email: string, role: RoleKey) {
  ids[key] = (await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } })).id;
}

const input = (title: string) => ({ title, categoryId, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER" as const, price: "", passingScore: 70 });

/** A draft course with one published module and one ordinary (gated) text lesson, and no welcome video. */
async function course(title: string) {
  const id = await createCourse(db, coach(), input(title));
  const m = await db.courseModule.create({ data: { courseId: id, order: 1, title: "Module 1", status: "PUBLISHED" } });
  await db.courseLesson.create({ data: { moduleId: m.id, order: 1, title: "Lesson 1", contentType: "TEXT", body: "Hello", status: "PUBLISHED" } });
  return { id, moduleId: m.id };
}

const welcome = (moduleId: string, courseId: string, over: Record<string, unknown> = {}) =>
  db.courseLesson.create({ data: { moduleId, order: 0, title: "Welcome", contentType: "VIDEO", storageKey: `lessons/${courseId}/w.mp4`, fileName: "w.mp4", status: "PUBLISHED", isFreePreview: true, isRequired: false, ...over } });

beforeAll(async () => {
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("sales", "sales@hirewise.example", "SALES");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  categoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("welcome video rule (pure)", () => {
  const lesson = (o: Record<string, unknown> = {}) => ({ status: "PUBLISHED", isFreePreview: true, contentType: "VIDEO", storageKey: "k", url: null, title: "Welcome", ...o });
  const mods = (lessons: unknown[], status = "PUBLISHED") => [{ status, lessons }] as Parameters<typeof hasWelcomeVideo>[0];

  it("needs a published, uploaded, free-preview video in a published module", () => {
    expect(hasWelcomeVideo(mods([lesson()]))).toBe(true);
    expect(hasWelcomeVideo(mods([lesson({ storageKey: null, url: "https://youtu.be/x" })]))).toBe(false);
    expect(hasWelcomeVideo(mods([lesson({ isFreePreview: false })]))).toBe(false);
    expect(hasWelcomeVideo(mods([lesson({ contentType: "TEXT" })]))).toBe(false);
    expect(hasWelcomeVideo(mods([lesson({ status: "DRAFT" })]))).toBe(false);
    expect(hasWelcomeVideo(mods([lesson()], "DRAFT"))).toBe(false);
    expect(hasWelcomeVideo([])).toBe(false);
  });

  it("explains each way it is missing", () => {
    expect(welcomeVideoProblem(mods([lesson()]))).toBeNull();
    expect(welcomeVideoProblem(mods([]))).toMatch(/no welcome video/);
    expect(welcomeVideoProblem(mods([lesson({ storageKey: null, url: "https://youtu.be/x" })]))).toMatch(/external link/);
    expect(welcomeVideoProblem(mods([lesson({ status: "DRAFT" })]))).toMatch(/not published yet/);
  });
});

describe("a course cannot go live without its welcome video", () => {
  it("submit, publish, and publish-own are all refused with a clear message, and nothing changes", async () => {
    const c = await course("No welcome");
    await expect(submitCourseForApproval(db, coach(), c.id)).rejects.toThrow(/no welcome video/);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");
    await expect(publishCourse(db, admin(), c.id, {})).rejects.toBeInstanceOf(UserMessageError);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");
    await setSetting(db, owner(), "academy", { requireApproval: false });
    await expect(publishOwnCourse(db, coach(), c.id)).rejects.toThrow(/no welcome video/);
    await setSetting(db, owner(), "academy", { requireApproval: true });
  });

  it("a linked video, a draft lesson, a quiz, or a non-preview video does not count", async () => {
    const c = await course("Wrong welcome");
    const link = await welcome(c.moduleId, c.id, { storageKey: null, url: "https://www.youtube.com/watch?v=abc" });
    await expect(publishCourse(db, admin(), c.id, {})).rejects.toThrow(/external link/);
    await db.courseLesson.delete({ where: { id: link.id } });
    const draft = await welcome(c.moduleId, c.id, { status: "DRAFT" });
    await expect(publishCourse(db, admin(), c.id, {})).rejects.toThrow(/not published yet/);
    await db.courseLesson.delete({ where: { id: draft.id } });
    await welcome(c.moduleId, c.id, { isFreePreview: false });
    await expect(publishCourse(db, admin(), c.id, {})).rejects.toThrow(/no welcome video/);
  });

  it("with an uploaded free-preview video the same course submits and publishes", async () => {
    const c = await course("Has welcome");
    await welcome(c.moduleId, c.id);
    await submitCourseForApproval(db, coach(), c.id);
    await publishCourse(db, admin(), c.id, {});
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PUBLISHED");
  });

  it("the own-publish path accepts it too (approval off)", async () => {
    const c = await course("Own welcome");
    await welcome(c.moduleId, c.id);
    await setSetting(db, owner(), "academy", { requireApproval: false });
    await publishOwnCourse(db, coach(), c.id);
    await setSetting(db, owner(), "academy", { requireApproval: true });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PUBLISHED");
  });

  it("restoring an archived course needs it as well", async () => {
    const c = await course("Archived welcome");
    const w = await welcome(c.moduleId, c.id);
    await publishCourse(db, admin(), c.id, {});
    await archiveCourse(db, admin(), c.id);
    await db.courseLesson.delete({ where: { id: w.id } });
    await expect(restoreCourse(db, admin(), c.id)).rejects.toThrow(/no welcome video/);
    await welcome(c.moduleId, c.id);
    await restoreCourse(db, admin(), c.id);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PUBLISHED");
  });

  it("roles that may not publish still get Forbidden, not the welcome message", async () => {
    const c = await course("Forbidden");
    await expect(publishCourse(db, sales(), c.id, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishCourse(db, coach(), c.id, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("courses already live are left alone, and staff can see them", () => {
  it("a published course without a welcome video stays published and is flagged in the staff list", async () => {
    const c = await course("Grandfathered");
    await db.academyCourse.update({ where: { id: c.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const row = (await listAllCoursesForStaff(db, admin())).find((x) => x.id === c.id)!;
    expect(row.status).toBe("PUBLISHED");
    expect(row.hasWelcome).toBe(false);
    await welcome(c.moduleId, c.id);
    expect((await listAllCoursesForStaff(db, admin())).find((x) => x.id === c.id)!.hasWelcome).toBe(true);
    await expect(listAllCoursesForStaff(db, sales())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
