import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { catalogForAgent, createCourseCoverUploadUrl, setCourseCover, listCoursesForCoach, getCourseForCoach, getEnrollmentForAgent, enrol } from "@/server/services/academy.service";
import { myCourses } from "@/server/services/learner.service";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";

const db = testDb();
let dir = "";
const ids = { coach: "coach_cv1", coach2: "coach_cv2", admin: "admin_cv", sales: "sales_cv", agentUser: "", agentProfile: "", published: "", draft: "", bare: "" };
const png = Buffer.from("89504e470d0a1a0a", "hex");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-cover-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  resetRateLimits();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  const u = await db.user.create({ data: { email: "agent@t.example", roleId: await role("AGENT") } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: "Agent One", headline: "H", primaryRole: "Appointment Setter", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  ids.agentUser = u.id;
  ids.agentProfile = p.id;
  const mk = async (title: string, status: "PUBLISHED" | "DRAFT") => {
    const c = await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", status, ownerCoachUserId: ids.coach } });
    await db.courseCoach.create({ data: { courseId: c.id, coachUserId: ids.coach } });
    return c.id;
  };
  ids.published = await mk("Cold Calling Masterclass", "PUBLISHED");
  ids.draft = await mk("Master Closer", "DRAFT");
  ids.bare = await mk("Upwork Tutorial", "PUBLISHED");
});

afterAll(async () => {
  resetStorageForTests();
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });

/** Uploads a tiny PNG through the same two steps the browser uses and returns its key. */
async function uploadCover(courseId: string, actor = coach) {
  const req = await createCourseCoverUploadUrl(db, await actor(), courseId, { contentType: "image/png", sizeBytes: png.length });
  await getStorage().put(req.key, png, "image/png");
  return req.key;
}

describe("cover upload", () => {
  it("issues a presigned PUT scoped to the course for PNG, JPG, and WebP only", async () => {
    resetRateLimits();
    const r = await createCourseCoverUploadUrl(db, await coach(), ids.published, { contentType: "image/png", sizeBytes: 500_000 });
    expect(r.key.startsWith(`courses/${ids.published}/cover/`)).toBe(true);
    expect(r.key.endsWith(".png")).toBe(true);
    expect(r.method).toBe("PUT");
    for (const [type, ext] of [["image/jpeg", ".jpg"], ["image/webp", ".webp"]] as const) expect((await createCourseCoverUploadUrl(db, await coach(), ids.published, { contentType: type, sizeBytes: 1000 })).key.endsWith(ext)).toBe(true);
    for (const bad of ["image/svg+xml", "image/gif", "application/pdf", "text/html"]) await expect(createCourseCoverUploadUrl(db, await coach(), ids.published, { contentType: bad, sizeBytes: 1000 })).rejects.toThrow(/PNG, JPG, or WebP/);
    await expect(createCourseCoverUploadUrl(db, await coach(), ids.published, { contentType: "image/png", sizeBytes: 2 * 1024 * 1024 + 1 })).rejects.toThrow(/too large/);
    expect((await createCourseCoverUploadUrl(db, await coach(), ids.published, { contentType: "image/png", sizeBytes: 2 * 1024 * 1024 })).key).toBeTruthy();
  });

  it("only the owning or assigned coach and Academy admins may upload; everyone else is refused", async () => {
    resetRateLimits();
    expect((await createCourseCoverUploadUrl(db, admin(), ids.published, { contentType: "image/png", sizeBytes: 1000 })).key).toBeTruthy();
    await expect(createCourseCoverUploadUrl(db, await coach2(), ids.published, { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(NotFoundError);
    await expect(createCourseCoverUploadUrl(db, agent(), ids.published, { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(ForbiddenError);
    await expect(createCourseCoverUploadUrl(db, sales(), ids.published, { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(ForbiddenError);
    await expect(createCourseCoverUploadUrl(db, await coach(), "missing", { contentType: "image/png", sizeBytes: 1000 })).rejects.toThrow(NotFoundError);
  });
});

describe("setting and clearing the cover", () => {
  it("records only an uploaded key that belongs to the course, audits it, and removes the replaced object", async () => {
    resetRateLimits();
    await expect(setCourseCover(db, await coach(), ids.published, "courses/other/cover/x.png")).rejects.toThrow(/does not belong/);
    await expect(setCourseCover(db, await coach(), ids.published, `courses/${ids.published}/cover/2026-01-01/never-uploaded.png`)).rejects.toThrow(/Upload the image/);
    await expect(setCourseCover(db, await coach2(), ids.published, null)).rejects.toThrow(NotFoundError);
    await expect(setCourseCover(db, agent(), ids.published, null)).rejects.toThrow(ForbiddenError);

    const first = await uploadCover(ids.published);
    const r1 = await setCourseCover(db, await coach(), ids.published, first);
    expect(r1.coverUrl).toContain("/api/storage/");
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: ids.published } })).thumbnailKey).toBe(first);
    expect(await db.auditLog.count({ where: { action: "COURSE_COVER_SET", entityId: ids.published } })).toBe(1);

    const second = await uploadCover(ids.published);
    await setCourseCover(db, await coach(), ids.published, second);
    expect(await getStorage().exists(first)).toBe(false);
    expect(await getStorage().exists(second)).toBe(true);

    expect((await setCourseCover(db, await coach(), ids.published, null)).coverUrl).toBeNull();
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: ids.published } })).thumbnailKey).toBeNull();
    expect(await getStorage().exists(second)).toBe(false);
  });
});

describe("signed delivery after authorization", () => {
  it("talent get a signed link only for published courses with a cover; the storage key is never in the view", async () => {
    resetRateLimits();
    const key = await uploadCover(ids.published);
    await setCourseCover(db, await coach(), ids.published, key);
    const draftKey = await uploadCover(ids.draft);
    await setCourseCover(db, await coach(), ids.draft, draftKey);

    const catalog = await catalogForAgent(db, agent());
    const cold = catalog.find((c) => c.id === ids.published)!;
    expect(cold.coverUrl).toMatch(/^http:\/\/localhost:3000\/api\/storage\/.+exp=\d+&sig=[0-9a-f]+$/);
    expect(catalog.find((c) => c.id === ids.bare)!.coverUrl).toBeNull();
    // A draft never reaches talent, with or without a cover.
    expect(catalog.some((c) => c.id === ids.draft)).toBe(false);
    const json = JSON.stringify(catalog);
    expect(json.includes("thumbnailKey")).toBe(false);
    expect(json.includes(draftKey)).toBe(false);
    expect(json.includes(encodeURIComponent(draftKey))).toBe(false);

    // The course page and My courses carry the same signed link.
    expect((await getEnrollmentForAgent(db, agent(), ids.published)).course.coverUrl).toMatch(/\/api\/storage\//);
    await enrol(db, agent(), ids.published);
    expect((await getEnrollmentForAgent(db, agent(), ids.published)).course.coverUrl).toMatch(/\/api\/storage\//);
    const mine = await myCourses(db, agent());
    const card = mine.cards.find((c) => c.courseId === ids.published)!;
    expect(card.coverUrl).toMatch(/\/api\/storage\//);
    expect(card.description).toContain("course description");
    expect(card.difficulty).toBe("BEGINNER");
  });

  it("coaches and admins see covers on their own courses, including drafts; another coach sees none of them", async () => {
    const mine = await listCoursesForCoach(db, await coach());
    expect(mine.find((c) => c.id === ids.draft)!.coverUrl).toMatch(/\/api\/storage\//);
    expect(mine.find((c) => c.id === ids.bare)!.coverUrl).toBeNull();
    expect((await getCourseForCoach(db, await coach(), ids.draft)).course.coverUrl).toMatch(/\/api\/storage\//);
    expect((await listCoursesForCoach(db, admin())).length).toBe(3);
    expect(await listCoursesForCoach(db, await coach2())).toEqual([]);
    await expect(getCourseForCoach(db, await coach2(), ids.draft)).rejects.toThrow(NotFoundError);
  });
});
