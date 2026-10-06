import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { getWelcomeVideoConfig, updateWelcomeVideoConfig, createWelcomeVideoUploadUrl, onboardingFor, coursesLockedFor, recordVideoProgress, onboardingAdminList, statusOf, KEEP_WELCOME_FILE } from "@/server/services/onboarding.service";
import { catalogForAgent, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { resetEnvCache } from "@/server/env";
import { resetStorageForTests, getStorage } from "@/server/adapters/storage";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";

const db = testDb();
let dir = "";
const ids = { admin: "admin_ob", coach: "coach_ob", oldUser: "", oldProfile: "", newUser: "", newProfile: "", course: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-ob-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  const agentRole = await role("AGENT");
  // An existing talent account (created before the requirement is enabled) with a verified email and a submitted profile.
  const old = await db.user.create({ data: { email: "old.talent@t.example", roleId: agentRole, emailVerifiedAt: new Date(), createdAt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } });
  ids.oldUser = old.id;
  ids.oldProfile = (await db.agentProfile.create({ data: { userId: old.id, displayName: "Old T.", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", submittedAt: new Date() } })).id;
  ids.course = (await db.academyCourse.create({ data: { code: "welcome-test-course", title: "Cold Calling Course", category: "Sales", description: "A course description long enough to satisfy validation rules.", ownerCoachUserId: ids.coach, status: "PUBLISHED", publishedAt: new Date(), coaches: { create: { coachUserId: ids.coach } } } })).id;
});

afterAll(async () => {
  resetStorageForTests();
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const coach = () => makeActor("COACH", { userId: ids.coach });
const oldAgent = () => makeActor("AGENT", { userId: ids.oldUser, agentProfileId: ids.oldProfile });
const newAgent = () => makeActor("AGENT", { userId: ids.newUser, agentProfileId: ids.newProfile });

const baseConfig = { enabled: true, title: "Welcome to Hirewise", instructions: "Watch this first.", videoUrl: "https://cdn.example.com/welcome.mp4", storageKey: "", fileName: "", durationSec: "" as const, requiredPercent: 90, lockCourses: true, appliesTo: "NEW" as const };

describe("admin configuration", () => {
  it("defaults are off; admin enables the requirement; coaches cannot; enabling without a video is refused", async () => {
    const cfg = await getWelcomeVideoConfig(db);
    expect(cfg.enabled).toBe(false);
    expect(cfg.requiredPercent).toBe(90);
    await expect(updateWelcomeVideoConfig(db, coach(), baseConfig)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateWelcomeVideoConfig(db, admin(), { ...baseConfig, videoUrl: "" })).rejects.toThrow(/Upload a video or enter a video URL/);
    const saved = await updateWelcomeVideoConfig(db, admin(), baseConfig);
    expect(saved.enabled).toBe(true);
    expect(saved.effectiveFrom).toBeTruthy();
    expect(saved.videoUrl).toBe("https://cdn.example.com/welcome.mp4");
    expect(await db.auditLog.count({ where: { action: "ONBOARDING_SETTINGS_CHANGED" } })).toBe(1);
  });

  it("upload URLs are scoped and type-checked; an uploaded file replaces the URL and keeps on later saves", async () => {
    await expect(createWelcomeVideoUploadUrl(db, coach(), { contentType: "video/mp4", sizeBytes: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createWelcomeVideoUploadUrl(db, admin(), { contentType: "application/pdf", sizeBytes: 10 })).rejects.toThrow(/Unsupported/);
    const up = await createWelcomeVideoUploadUrl(db, admin(), { contentType: "video/mp4", sizeBytes: 10 });
    expect(up.key.startsWith("onboarding/welcome/")).toBe(true);
    await expect(updateWelcomeVideoConfig(db, admin(), { ...baseConfig, storageKey: up.key, fileName: "welcome.mp4" })).rejects.toThrow(/not uploaded/);
    await getStorage().put(up.key, Buffer.from("0000"), "video/mp4");
    const before = await getWelcomeVideoConfig(db);
    const withFile = await updateWelcomeVideoConfig(db, admin(), { ...baseConfig, storageKey: up.key, fileName: "welcome.mp4", durationSec: 120 });
    expect(withFile.storageKey).toBe(up.key);
    expect(withFile.videoUrl).toBeNull();
    expect(withFile.durationSec).toBe(120);
    expect(withFile.videoKey).not.toBe(before.videoKey); // new source, new progress key
    const kept = await updateWelcomeVideoConfig(db, admin(), { ...baseConfig, storageKey: KEEP_WELCOME_FILE, requiredPercent: 80 });
    expect(kept.storageKey).toBe(up.key);
    expect(kept.videoKey).toBe(withFile.videoKey);
    expect(kept.requiredPercent).toBe(80);
    // back to the URL source for the rest of the tests
    await updateWelcomeVideoConfig(db, admin(), baseConfig);
  });
});

describe("who the requirement applies to", () => {
  it("NEW: only accounts created after enabling; ALL: everyone; staff never", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
    const u = await db.user.create({ data: { email: "new.talent@t.example", roleId: role.id } });
    ids.newUser = u.id;
    ids.newProfile = (await db.agentProfile.create({ data: { userId: u.id, displayName: "New T.", headline: "H", primaryRole: "VA", status: "DRAFT", availabilityStatus: "UNAVAILABLE", timezone: "Asia/Manila" } })).id;

    const oldView = await onboardingFor(db, oldAgent());
    expect(oldView.video.required).toBe(false);
    expect(oldView.coursesLocked).toBe(false);
    expect(oldView.done).toBe(true);
    expect(oldView.steps.map((s) => s.key)).toEqual(["email", "profile", "courses"]);

    const newView = await onboardingFor(db, newAgent());
    expect(newView.video.required).toBe(true);
    expect(newView.coursesLocked).toBe(true);
    expect(newView.steps.map((s) => [s.key, s.done])).toEqual([["email", false], ["profile", false], ["video", false], ["courses", false]]);
    expect(newView.completed).toBe(0);
    expect(newView.total).toBe(3);
    expect(newView.status).toBe("EMAIL_NOT_VERIFIED");

    expect((await onboardingFor(db, admin())).applies).toBe(false);
    expect((await coursesLockedFor(db, coach())).locked).toBe(false);

    await updateWelcomeVideoConfig(db, admin(), { ...baseConfig, appliesTo: "ALL" });
    expect((await onboardingFor(db, oldAgent())).video.required).toBe(true);
    expect((await coursesLockedFor(db, oldAgent())).locked).toBe(true);
    await updateWelcomeVideoConfig(db, admin(), baseConfig);
    expect((await coursesLockedFor(db, oldAgent())).locked).toBe(false);
  });

  it("statuses follow the checklist order", () => {
    expect(statusOf({ emailVerified: false, profileDone: true, videoRequired: true, videoDone: true })).toBe("EMAIL_NOT_VERIFIED");
    expect(statusOf({ emailVerified: true, profileDone: false, videoRequired: true, videoDone: false })).toBe("PROFILE_INCOMPLETE");
    expect(statusOf({ emailVerified: true, profileDone: true, videoRequired: true, videoDone: false })).toBe("WELCOME_VIDEO_PENDING");
    expect(statusOf({ emailVerified: true, profileDone: true, videoRequired: false, videoDone: false })).toBe("ONBOARDING_COMPLETED");
    expect(statusOf({ emailVerified: true, profileDone: true, videoRequired: true, videoDone: true })).toBe("ONBOARDING_COMPLETED");
  });
});

describe("watching the video and unlocking courses", () => {
  it("courses are locked until the required share is actually watched; seeking and fast reports do not count", async () => {
    await db.user.update({ where: { id: ids.newUser }, data: { emailVerifiedAt: new Date() } });
    await db.agentProfile.update({ where: { id: ids.newProfile }, data: { submittedAt: new Date(), status: "SUBMITTED" } });

    let catalog = await catalogForAgent(db, newAgent());
    expect(catalog.find((c) => c.id === ids.course)?.locked).toBe(true);
    expect(catalog.find((c) => c.id === ids.course)?.lockReason).toMatch(/Welcome to Hirewise/);
    await expect(enrol(db, newAgent(), ids.course)).rejects.toBeInstanceOf(ForbiddenError);
    const detail = await getEnrollmentForAgent(db, newAgent(), ids.course);
    expect(detail.locked?.href).toBe("/onboarding/welcome-video");

    // 20% watched: still locked
    let p = await recordVideoProgress(db, newAgent(), { positionSec: 20, watchedDeltaSec: 20, durationSec: 100, elapsedMs: 20_500 });
    expect(p.percent).toBe(20);
    expect(p.completed).toBe(false);
    expect((await onboardingFor(db, newAgent())).status).toBe("WELCOME_VIDEO_PENDING");

    // a report claiming 60 s watched in 5 s of wall-clock is credited at most 7 s
    p = await recordVideoProgress(db, newAgent(), { positionSec: 95, watchedDeltaSec: 60, durationSec: 100, elapsedMs: 5_000 });
    expect(p.percent).toBe(27);
    expect(p.completed).toBe(false);
    expect(p.lastPositionSec).toBe(95);

    // honest watching reaches the threshold
    for (let i = 0; i < 4; i++) p = await recordVideoProgress(db, newAgent(), { positionSec: 60 + i * 10, watchedDeltaSec: 15, durationSec: 100, elapsedMs: 15_000 });
    expect(p.percent).toBe(87);
    expect(p.completed).toBe(false);
    p = await recordVideoProgress(db, newAgent(), { positionSec: 100, watchedDeltaSec: 5, durationSec: 100, elapsedMs: 5_000 });
    expect(p.percent).toBe(92);
    expect(p.completed).toBe(true);
    expect(p.completedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "ONBOARDING_VIDEO_COMPLETED", actorUserId: ids.newUser } })).toBe(1);

    const view = await onboardingFor(db, newAgent());
    expect(view.done).toBe(true);
    expect(view.status).toBe("ONBOARDING_COMPLETED");
    expect(view.coursesLocked).toBe(false);
    catalog = await catalogForAgent(db, newAgent());
    expect(catalog.find((c) => c.id === ids.course)?.locked).toBe(false);
    await enrol(db, newAgent(), ids.course);
    expect(await db.courseEnrollment.count({ where: { agentProfileId: ids.newProfile } })).toBe(1);

    // further reports never un-complete and the audit row is written once
    p = await recordVideoProgress(db, newAgent(), { positionSec: 100, watchedDeltaSec: 10, durationSec: 100, elapsedMs: 10_000 });
    expect(p.completed).toBe(true);
    expect(await db.auditLog.count({ where: { action: "ONBOARDING_VIDEO_COMPLETED", actorUserId: ids.newUser } })).toBe(1);
  });

  it("replacing the video starts fresh progress; a lower threshold completes sooner; staff cannot report progress", async () => {
    await updateWelcomeVideoConfig(db, admin(), { ...baseConfig, videoUrl: "https://cdn.example.com/welcome-v2.mp4", requiredPercent: 50 });
    const view = await onboardingFor(db, newAgent());
    expect(view.video.percent).toBe(0);
    expect(view.video.completedAt).toBeNull();
    expect(view.coursesLocked).toBe(true);
    // already enrolled courses stay open, un-enrolled ones are locked again
    const catalog = await catalogForAgent(db, newAgent());
    expect(catalog.find((c) => c.id === ids.course)?.locked).toBe(false);
    const p = await recordVideoProgress(db, newAgent(), { positionSec: 50, watchedDeltaSec: 50, durationSec: 100, elapsedMs: 50_000 });
    expect(p.percent).toBe(50);
    expect(p.completed).toBe(true);
    await expect(recordVideoProgress(db, admin(), { positionSec: 1, watchedDeltaSec: 1, durationSec: 100 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin sees per-user verification and video status with a summary; coaches do not", async () => {
    await expect(onboardingAdminList(db, coach())).rejects.toBeInstanceOf(ForbiddenError);
    const { rows, summary, config } = await onboardingAdminList(db, admin());
    expect(config.requiredPercent).toBe(50);
    const n = rows.find((r) => r.userId === ids.newUser)!;
    expect(n.emailVerified).toBe(true);
    expect(n.profileDone).toBe(true);
    expect(n.videoRequired).toBe(true);
    expect(n.videoPercent).toBe(50);
    expect(n.videoCompletedAt).not.toBeNull();
    expect(n.statusLabel).toBe("Onboarding completed");
    const o = rows.find((r) => r.userId === ids.oldUser)!;
    expect(o.videoRequired).toBe(false);
    expect(o.status).toBe("ONBOARDING_COMPLETED");
    expect(summary.ONBOARDING_COMPLETED).toBe(2);
    expect(summary.completedVideo).toBe(1);
    const filtered = await onboardingAdminList(db, admin(), "old.talent");
    expect(filtered.rows.map((r) => r.userId)).toEqual([ids.oldUser]);
  });
});
