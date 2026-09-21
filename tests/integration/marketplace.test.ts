import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { searchCandidates, getCandidateForClient, recommendedForClient } from "@/server/services/search.service";
import { addToShortlist, removeFromShortlist, setShortlistNote, getOwnShortlist, compareShortlisted, getShortlistForStaff, shortlistActivityForStaff } from "@/server/services/shortlist.service";
import { reviewMedia, listMediaReviewQueue, mediaDownloadUrl } from "@/server/services/media.service";
import { addNote, listNotesForStaff, listNotesForSubject } from "@/server/services/note.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const db = testDb();
let dir = "";
const ids = { clientA: "", clientB: "", userA: "", userB: "", approved: "", approved2: "", draft: "", skillCs: "", skillCc: "", videoApproved: "", videoSubmitted: "", agentUser: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-mkt-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;

  const cs = await db.skill.create({ data: { name: "Customer Service", category: "Support" } });
  const cc = await db.skill.create({ data: { name: "Cold Calling", category: "Sales" } });
  ids.skillCs = cs.id;
  ids.skillCc = cc.id;

  const sales = await db.user.create({ data: { id: "sales_1", email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: "rec_1", email: "rec@hirewise.example", roleId: await role("RECRUITER") } });
  await db.user.create({ data: { id: "admin_1", email: "admin@hirewise.example", roleId: await role("ADMIN") } });

  const uA = await db.user.create({ data: { email: "a@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "b@beta.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.userA = uA.id;
  ids.userB = uB.id;
  const cA = await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: sales.id, contacts: { create: { userId: uA.id, name: "A", businessEmail: uA.email, isPrimary: true } }, onboarding: { create: { servicesNeeded: ["Customer Service"], agentsRequired: 1 } } } });
  const cB = await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "B", businessEmail: uB.email, isPrimary: true } } } });
  const cPending = await db.client.create({ data: { companyName: "Pending Co", status: "PENDING_REVIEW" } });
  ids.clientA = cA.id;
  ids.clientB = cB.id;
  const uP = await db.user.create({ data: { email: "p@pending.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  await db.clientContact.create({ data: { clientId: cPending.id, userId: uP.id, name: "P", businessEmail: uP.email, isPrimary: true } });

  const agentRole = await role("AGENT");
  const mk = async (email: string, status: "APPROVED" | "DRAFT", opts: { availability?: "AVAILABLE" | "PLACED"; skill?: string; role?: string; tz?: string; verification?: "PROFILE_VERIFIED" | "HIREWISE_CERTIFIED" } = {}) => {
    const u = await db.user.create({ data: { email, roleId: agentRole } });
    const p = await db.agentProfile.create({
      data: {
        userId: u.id, displayName: email.split("@")[0], headline: `Headline for ${email}`, primaryRole: opts.role ?? "Customer Service Representative", status, availabilityStatus: opts.availability ?? "AVAILABLE", timezone: opts.tz ?? "Asia/Manila", verificationLevel: opts.verification ?? "PROFILE_VERIFIED", approvedAt: status === "APPROVED" ? new Date() : undefined, languages: ["English"],
        privateContact: { create: { fullLegalName: email, personalEmail: email, phone: "+63" } },
        skills: opts.skill ? { create: { skillId: opts.skill, level: "ADVANCED" } } : undefined,
        experiences: { create: { title: "Rep", startDate: new Date("2023-01-01"), isCampaign: true } },
      },
    });
    return { u, p };
  };
  const a1 = await mk("approved1@t.example", "APPROVED", { skill: cs.id, verification: "HIREWISE_CERTIFIED" });
  const a2 = await mk("approved2@t.example", "APPROVED", { skill: cc.id, role: "Cold Caller", tz: "America/New_York" });
  await mk("placed@t.example", "APPROVED", { availability: "PLACED", skill: cs.id });
  const d = await mk("draft@t.example", "DRAFT", { skill: cs.id });
  ids.approved = a1.p.id;
  ids.approved2 = a2.p.id;
  ids.draft = d.p.id;
  ids.agentUser = a1.u.id;
  ids.videoApproved = (await db.video.create({ data: { agentProfileId: a1.p.id, storageKey: "agents/x/video/a.mp4", status: "APPROVED", isCurrent: true } })).id;
  ids.videoSubmitted = (await db.video.create({ data: { agentProfileId: a1.p.id, storageKey: "agents/x/video/b.mp4", status: "SUBMITTED", submittedAt: new Date() } })).id;
  await db.recording.create({ data: { agentProfileId: a1.p.id, kind: "COLD_CALL", title: "Sample", storageKey: "agents/x/recording/a.mp3", status: "SUBMITTED", submittedAt: new Date() } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.userB, clientId: ids.clientB });

describe("marketplace access (Section 14 Q2: gated)", () => {
  it("pending clients and agents are refused; staff with agent.read_public may search", async () => {
    const pending = await db.client.findFirstOrThrow({ where: { companyName: "Pending Co" } });
    await expect(searchCandidates(db, makeActor("CLIENT", { clientId: pending.id }), {})).rejects.toThrow(ForbiddenError);
    await expect(searchCandidates(db, makeActor("AGENT", { agentProfileId: ids.approved }), {})).rejects.toThrow(ForbiddenError);
    expect((await searchCandidates(db, makeActor("SALES"), {})).total).toBeGreaterThan(0);
  });
});

describe("search (Section 8.3)", () => {
  it("returns only APPROVED, available candidates by default and never leaks private fields", async () => {
    const r = await searchCandidates(db, clientA(), {});
    const names = r.cards.map((c) => c.displayName);
    expect(names).toContain("approved1");
    expect(names).toContain("approved2");
    expect(names).not.toContain("draft");
    expect(names).not.toContain("placed");
    const json = JSON.stringify(r.cards);
    expect(json).not.toMatch(/personalEmail|phone|fullLegalName|storageKey|reviewFeedback/);
  });

  it("filters by skill, role, verification, and availability", async () => {
    expect((await searchCandidates(db, clientA(), { skills: [ids.skillCs] })).cards.map((c) => c.displayName)).toEqual(["approved1"]);
    expect((await searchCandidates(db, clientA(), { role: "Cold Caller" })).cards.map((c) => c.displayName)).toEqual(["approved2"]);
    expect((await searchCandidates(db, clientA(), { verification: "HIREWISE_CERTIFIED" })).cards.map((c) => c.displayName)).toEqual(["approved1"]);
    expect((await searchCandidates(db, clientA(), { availability: ["PLACED"] })).cards.map((c) => c.displayName)).toEqual(["placed"]);
  });

  it("sorts recommended by verification level first and computes timezone distance from the client", async () => {
    const r = await searchCandidates(db, clientA(), {});
    expect(r.cards[0].displayName).toBe("approved1");
    const ny = r.cards.find((c) => c.displayName === "approved2")!;
    expect(ny.tzDiffHours).toBeLessThanOrEqual(3);
    const within = await searchCandidates(db, clientA(), { tzWithin: 3 });
    expect(within.cards.map((c) => c.displayName)).toEqual(["approved2"]);
  });

  it("opening a candidate records a view and an introduction; unapproved profiles are 404", async () => {
    const r = await getCandidateForClient(db, clientA(), ids.approved);
    expect(r.candidate.videos.map((v) => v.id)).toEqual([ids.videoApproved]);
    expect(await db.candidateView.count({ where: { clientId: ids.clientA, agentProfileId: ids.approved } })).toBe(1);
    expect((await db.introduction.findUniqueOrThrow({ where: { clientId_agentProfileId: { clientId: ids.clientA, agentProfileId: ids.approved } } })).firstEvent).toBe("VIEW");
    await expect(getCandidateForClient(db, clientA(), ids.draft)).rejects.toThrow(NotFoundError);
  });

  it("recommendations favour the services the client asked for", async () => {
    const rec = await recommendedForClient(db, clientA());
    expect(rec[0].displayName).toBe("approved1");
  });
});

describe("shortlist (Section 8.4)", () => {
  it("add is idempotent, audited, notifies the account manager, and refuses unapproved agents", async () => {
    await addToShortlist(db, clientA(), ids.approved);
    await addToShortlist(db, clientA(), ids.approved);
    await expect(addToShortlist(db, clientA(), ids.draft)).rejects.toThrow(NotFoundError);
    const list = await getOwnShortlist(db, clientA());
    expect(list.candidates.map((c) => c.id)).toEqual([ids.approved]);
    expect(await db.auditLog.count({ where: { action: "CANDIDATE_SHORTLISTED", entityId: ids.approved } })).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "sales_1", type: "CANDIDATE_SHORTLISTED" } })).toBe(1);
  });

  it("notes and compare are scoped to the client's own shortlist", async () => {
    await setShortlistNote(db, clientA(), ids.approved, "Great CSAT");
    expect((await getOwnShortlist(db, clientA())).candidates[0].note).toBe("Great CSAT");
    await addToShortlist(db, clientA(), ids.approved2);
    const cmp = await compareShortlisted(db, clientA(), [ids.approved, ids.approved2, ids.draft]);
    expect(cmp.map((c) => c.id)).toEqual([ids.approved, ids.approved2]);
    // Client B has an empty shortlist and cannot compare A's candidates.
    expect(await compareShortlisted(db, clientB(), [ids.approved])).toEqual([]);
    expect((await getOwnShortlist(db, clientB())).candidates).toEqual([]);
  });

  it("client B cannot read client A's shortlist by id (404), Sales sees assigned clients only", async () => {
    const listA = await db.shortlist.findFirstOrThrow({ where: { clientId: ids.clientA } });
    await expect(getShortlistForStaff(db, clientB(), listA.id)).rejects.toThrow(NotFoundError);
    expect((await getShortlistForStaff(db, makeActor("SALES", { userId: "sales_1", salesAssignedClientIds: [ids.clientA] }), listA.id)).candidates.length).toBe(2);
    await expect(getShortlistForStaff(db, makeActor("SALES", { userId: "other", salesAssignedClientIds: [] }), listA.id)).rejects.toThrow(ForbiddenError);
    const activity = await shortlistActivityForStaff(db, makeActor("SALES", { userId: "sales_1", salesAssignedClientIds: [ids.clientA] }));
    expect(activity.length).toBe(2);
    expect((await shortlistActivityForStaff(db, makeActor("SALES", { userId: "nobody", salesAssignedClientIds: [] }))).length).toBe(0);
    await expect(shortlistActivityForStaff(db, makeActor("COACH"))).rejects.toThrow(ForbiddenError);
  });

  it("remove hides the entry and a second add creates a fresh one", async () => {
    await removeFromShortlist(db, clientA(), ids.approved2);
    expect((await getOwnShortlist(db, clientA())).candidates.map((c) => c.id)).toEqual([ids.approved]);
    await addToShortlist(db, clientA(), ids.approved2);
    expect((await getOwnShortlist(db, clientA())).candidates.length).toBe(2);
  });
});

describe("media review (Section 5.3)", () => {
  it("queue lists submitted media; only media.review may act; rejection needs feedback", async () => {
    await expect(listMediaReviewQueue(db, makeActor("SALES"))).rejects.toThrow(ForbiddenError);
    const q = await listMediaReviewQueue(db, makeActor("RECRUITER", { userId: "rec_1" }));
    expect(q.videos.map((v) => v.id)).toEqual([ids.videoSubmitted]);
    expect(q.recordings.length).toBe(1);
    await expect(reviewMedia(db, makeActor("RECRUITER", { userId: "rec_1" }), { type: "VIDEO", id: ids.videoSubmitted, decision: "REJECTED" })).rejects.toThrow(/feedback/i);
  });

  it("approving a new video retires the previous approved one; agent notified; clients see only the new one", async () => {
    await reviewMedia(db, makeActor("RECRUITER", { userId: "rec_1" }), { type: "VIDEO", id: ids.videoSubmitted, decision: "APPROVED" });
    expect((await db.video.findUniqueOrThrow({ where: { id: ids.videoApproved } })).status).toBe("RETIRED");
    expect((await db.video.findUniqueOrThrow({ where: { id: ids.videoSubmitted } })).status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "VIDEO_APPROVED", entityId: ids.videoSubmitted } })).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "MEDIA_APPROVED" } })).toBe(1);
    const c = await getCandidateForClient(db, clientA(), ids.approved);
    expect(c.candidate.videos.map((v) => v.id)).toEqual([ids.videoSubmitted]);
    await expect(mediaDownloadUrl(db, clientA(), { type: "VIDEO", id: ids.videoApproved })).rejects.toThrow(NotFoundError);
  });

  it("revision request records feedback the agent can see", async () => {
    const rec = await db.recording.findFirstOrThrow();
    await reviewMedia(db, makeActor("ADMIN", { userId: "admin_1" }), { type: "RECORDING", id: rec.id, decision: "REVISION_REQUIRED", feedback: "Too much background noise" });
    expect((await db.recording.findUniqueOrThrow({ where: { id: rec.id } })).reviewFeedback).toBe("Too much background noise");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "MEDIA_REVISION_REQUIRED" } })).toBe(1);
  });
});

describe("internal notes (INV-P4)", () => {
  it("staff write and read; the agent sees only notes marked for them; clients never see agent notes", async () => {
    const rec = makeActor("RECRUITER", { userId: "rec_1" });
    await addNote(db, rec, "AGENT", ids.approved, { body: "Strong accent neutralisation, recommend for US voice campaigns.", visibility: "INTERNAL", pinned: true });
    await addNote(db, rec, "AGENT", ids.approved, { body: "Please add a customer-service sample.", visibility: "AGENT", pinned: false });
    await expect(addNote(db, makeActor("COACH"), "AGENT", ids.approved, { body: "x", visibility: "INTERNAL", pinned: false })).rejects.toThrow(ForbiddenError);
    expect((await listNotesForStaff(db, makeActor("SALES"), "AGENT", ids.approved)).length).toBe(2);
    const agentView = await listNotesForSubject(db, makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.approved }), "AGENT", ids.approved);
    expect(agentView.map((n) => n.body)).toEqual(["Please add a customer-service sample."]);
    expect(await listNotesForSubject(db, clientA(), "AGENT", ids.approved)).toEqual([]);
    expect(await listNotesForSubject(db, makeActor("AGENT", { userId: "other", agentProfileId: ids.approved2 }), "AGENT", ids.approved)).toEqual([]);
  });
});
