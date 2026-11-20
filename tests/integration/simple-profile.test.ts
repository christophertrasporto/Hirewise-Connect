import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { computeCompletion, getOwnProfile, submitForReview, updateSoftware, SubmissionBlockedError, SUBMIT_MIN_PERCENT } from "@/server/services/agent.service";
import { recordCoursePayment, recordCourseRefund } from "@/server/services/academy.service";
import { recomputeSkillVerification } from "@/server/services/skill-verification.service";
import { runMaintenance } from "@/server/jobs/worker";
import { makeActor } from "@/server/auth/actor";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
const tags: Record<string, string> = {};
const courses: Record<string, string> = {};

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const talent = (k: string) => makeActor("AGENT", { userId: ids[k], agentProfileId: profiles[k] });

async function mkTalent(key: string, over: { sections?: boolean } = {}) {
  const role = (await db.role.findUniqueOrThrow({ where: { key: "AGENT" as RoleKey } })).id;
  const u = await db.user.create({ data: { email: `${key}@hirewise.example`, roleId: role, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  const full = over.sections !== false;
  const p = await db.agentProfile.create({
    data: {
      userId: u.id, displayName: key, status: "DRAFT", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila",
      ...(full ? { headline: "Appointment setter with four years of US solar experience", summary: "x".repeat(120), primaryRole: "Cold Caller", experienceLevel: "MID", locationCity: "Cebu", languages: ["English"], workSetup: "REMOTE" } : {}),
      privateContact: { create: { fullLegalName: full ? `${key} Full Name` : "" } },
    },
  });
  profiles[key] = p.id;
  if (full) await db.experience.create({ data: { agentProfileId: p.id, title: "Setter", startDate: new Date("2024-01-01") } });
}

const mkCourse = async (key: string, tagKeys: string[], over: { priceCents?: number } = {}) => {
  const c = await db.academyCourse.create({ data: { code: `C-${key}`, title: `Course ${key}`, category: "Sales", description: "A course description long enough.", ownerCoachUserId: ids.coach, status: "PUBLISHED", priceCents: over.priceCents ?? 2500, currency: "PHP" } });
  courses[key] = c.id;
  for (const t of tagKeys) await db.courseSkillTag.create({ data: { courseId: c.id, skillId: tags[t] } });
  return c.id;
};
const enrol = (who: string, course: string, status: "PENDING" | "NOT_REQUIRED" | "PAID" = "PENDING", priceCents = 2500) =>
  db.courseEnrollment.create({ data: { courseId: courses[course], agentProfileId: profiles[who], paymentStatus: status, priceCents, currency: "PHP", paidCents: status === "PAID" ? priceCents : null, paidAt: status === "PAID" ? new Date() : null } });
const held = async (who: string) => (await db.agentSkill.findMany({ where: { agentProfileId: profiles[who] }, select: { skillId: true } })).map((s) => s.skillId).sort();
const slugsOf = async (who: string) => (await getOwnProfile(db, talent(who))).skills.map((s) => s.name).sort();

beforeAll(async () => {
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const roleOf = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  ids.admin = (await db.user.create({ data: { email: "admin@hirewise.example", roleId: await roleOf("ADMIN"), emailVerifiedAt: new Date() } })).id;
  ids.coach = (await db.user.create({ data: { email: "coach@hirewise.example", roleId: await roleOf("COACH"), emailVerifiedAt: new Date() } })).id;
  const mkTag = async (key: string, name: string, over: Record<string, unknown> = {}) => (tags[key] = (await db.skill.create({ data: { name, category: "Sales", slug: name.toLowerCase().replace(/\s+/g, "-"), hashtag: `#${name.replace(/\s+/g, "")}`, ...over } })).id);
  await mkTag("cold", "Cold Calling");
  await mkTag("crm", "CRM Management");
  await mkTag("retired", "Retired Skill", { isActive: false });
  for (const k of ["ana", "ben", "cy", "dee", "eli", "fay"]) await mkTalent(k);
  await mkTalent("newbie", { sections: false });
  await mkCourse("cold", ["cold"]);
  await mkCourse("both", ["cold", "crm"]);
  await mkCourse("untagged", []);
  await mkCourse("retired", ["retired"]);
  await mkCourse("free", ["crm"], { priceCents: 0 });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the simple profile: three sections, and nothing else is required", () => {
  it("a talent with personal, professional, and experience done scores 100 and can submit with no résumé, video, or voice sample", async () => {
    const view = await getOwnProfile(db, talent("ana"));
    const c = computeCompletion(view);
    expect(c.total).toBe(100);
    expect(c.parts.map((p) => [p.key, p.weight])).toEqual([["personal", 30], ["professional", 40], ["experience", 30]]);
    expect(c.extras.map((e) => [e.key, e.done])).toEqual([["resume", false], ["video", false], ["voice", false]]);
    await submitForReview(db, talent("ana"));
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: profiles.ana } })).status).toBe("SUBMITTED");
  });

  it("a video, voice sample, or résumé is optional and never changes the score", async () => {
    await db.agentPrivateContact.update({ where: { agentProfileId: profiles.ben }, data: { resumeKey: `agents/${profiles.ben}/resume/x.pdf` } });
    await db.video.create({ data: { agentProfileId: profiles.ben, storageKey: `agents/${profiles.ben}/video/x.mp4`, status: "SUBMITTED", isCurrent: true } });
    await db.recording.create({ data: { agentProfileId: profiles.ben, kind: "COLD_CALL", title: "Solar", storageKey: `agents/${profiles.ben}/recording/x.mp3`, status: "SUBMITTED" } });
    const c = computeCompletion(await getOwnProfile(db, talent("ben")));
    expect(c.total).toBe(100);
    expect(c.extras.every((e) => e.done)).toBe(true);
  });

  it("a profile missing a section is blocked below the minimum, and the message says which section", async () => {
    expect(SUBMIT_MIN_PERCENT).toBe(80);
    const c = computeCompletion(await getOwnProfile(db, talent("newbie")));
    expect(c.total).toBe(0);
    const err = await submitForReview(db, talent("newbie")).catch((e) => e);
    expect(err).toBeInstanceOf(SubmissionBlockedError);
    expect((err as SubmissionBlockedError).missing.join(" ")).toMatch(/personal information.*professional information.*work experience/);
    await db.experience.deleteMany({ where: { agentProfileId: profiles.cy } });
    expect(computeCompletion(await getOwnProfile(db, talent("cy"))).total).toBe(70);
    await expect(submitForReview(db, talent("cy"))).rejects.toBeInstanceOf(SubmissionBlockedError);
  });
});

describe("skills come only from courses a talent has access to", () => {
  it("having no course means no skills, and the software form cannot add one", async () => {
    expect(await held("dee")).toEqual([]);
    await updateSoftware(db, talent("dee"), { software: [] });
    expect(await held("dee")).toEqual([]);
    expect(Object.keys(await getOwnProfile(db, talent("dee"))).includes("skills")).toBe(true);
  });

  it("an unpaid enrolment gives nothing; paying (staff recording) gives the course's tags; a course with no tags gives none", async () => {
    const e = await enrol("dee", "both", "PENDING");
    await enrol("dee", "untagged", "PENDING");
    await recomputeSkillVerification(db, profiles.dee);
    expect(await held("dee")).toEqual([]);
    await recordCoursePayment(db, admin(), e.id, { paid: "25", reference: "BANK-1", waived: false });
    expect(await slugsOf("dee")).toEqual(["CRM Management", "Cold Calling"]);
    const untagged = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: profiles.dee, courseId: courses.untagged } });
    await recordCoursePayment(db, admin(), untagged.id, { paid: "25", reference: "BANK-2", waived: false });
    expect(await slugsOf("dee")).toEqual(["CRM Management", "Cold Calling"]);
  });

  it("a full refund takes the skills back; a partial refund keeps them", async () => {
    const e = await enrol("eli", "cold", "PENDING");
    await recordCoursePayment(db, admin(), e.id, { paid: "25", reference: "BANK-3", waived: false });
    expect(await slugsOf("eli")).toEqual(["Cold Calling"]);
    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", amount: "5", reason: "goodwill" });
    expect(await slugsOf("eli")).toEqual(["Cold Calling"]);
    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "full refund" });
    expect(await held("eli")).toEqual([]);
  });

  it("a waived or free enrolment counts, an agency-style revoked one does not, and an inactive tag is never given", async () => {
    const free = await enrol("fay", "free", "NOT_REQUIRED", 0);
    await enrol("fay", "retired", "PAID");
    await recomputeSkillVerification(db, profiles.fay);
    expect(await slugsOf("fay")).toEqual(["CRM Management"]); // the retired tag is not given
    await db.courseEnrollment.update({ where: { id: free.id }, data: { accessRevokedAt: new Date(), status: "REVOKED" } });
    await recomputeSkillVerification(db, profiles.fay);
    expect(await held("fay")).toEqual([]);
  });

  it("a skill row that no course backs is removed by the next recompute and by the worker's maintenance pass", async () => {
    await db.agentSkill.create({ data: { agentProfileId: profiles.ben, skillId: tags.crm } });
    expect(await held("ben")).toEqual([tags.crm]);
    await recomputeSkillVerification(db, profiles.ben);
    expect(await held("ben")).toEqual([]);
    await db.agentSkill.create({ data: { agentProfileId: profiles.cy, skillId: tags.cold } });
    await enrol("cy", "untagged", "PAID"); // an enrolment so the maintenance pass visits cy
    await runMaintenance(db);
    expect(await held("cy")).toEqual([]);
  });

  it("making a course tag change reaches everyone enrolled", async () => {
    await mkCourse("late", []);
    const e = await enrol("ana", "late", "PAID");
    expect(e.id).toBeTruthy();
    expect(await held("ana")).toEqual([]);
    await db.courseSkillTag.create({ data: { courseId: courses.late, skillId: tags.cold } });
    await runMaintenance(db);
    expect(await held("ana")).toEqual([tags.cold]);
  });
});
