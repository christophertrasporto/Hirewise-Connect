import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { addToShortlist } from "@/server/services/shortlist.service";
import { createRequirement } from "@/server/services/requirement.service";
import { createInterviewRequest, getRequest, startSalesReview, proposeSlots, clientConfirmSlots, candidateRespond, scheduleInterviews, completeInterview, recordClientDecision, cancelRequest, listRequestsForStaff } from "@/server/services/interview.service";
import { postMessage, listMessages, reviewHeldMessage, listHeldMessages } from "@/server/services/message.service";
import { reserveForClient, expireReservations, extendReservation, releaseReservation, AlreadyReservedError } from "@/server/services/reservation.service";
import { listPlacementsForClient, listPlacementsForAgent, listPlacementsForStaff } from "@/server/services/placement.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { collectKeys } from "@/server/views/forbidden-keys";

const db = testDb();
const ids = { clientA: "", clientB: "", userA: "", userB: "", agent1: "", agent1User: "", agent2: "", agent2User: "", requestId: "", interviewId: "" };

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.setting.create({ data: { key: "reservationTtlDays", value: 7 } });
  await db.user.create({ data: { id: "sales_1", email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: "admin_1", email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: "ops_1", email: "ops@hirewise.example", roleId: await role("OPERATIONS") } });

  const uA = await db.user.create({ data: { email: "a@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "b@beta.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.userA = uA.id;
  ids.userB = uB.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: "sales_1", contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.clientB = (await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "Sam", businessEmail: uB.email, isPrimary: true } } } })).id;

  const agentRole = await role("AGENT");
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: agentRole } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Appointment Setter", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date(), languages: ["English"], privateContact: { create: { fullLegalName: `${name} Legal`, phone: "+63 917 000 0000" } } } });
    await db.agentAvailability.create({ data: { agentProfileId: p.id, status: "AVAILABLE", reason: "seed" } });
    return { u, p };
  };
  const a1 = await mk("a1@t.example", "Maria S.");
  const a2 = await mk("a2@t.example", "Jose R.");
  ids.agent1 = a1.p.id;
  ids.agent1User = a1.u.id;
  ids.agent2 = a2.p.id;
  ids.agent2User = a2.u.id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.userB, clientId: ids.clientB });
const sales = () => makeActor("SALES", { userId: "sales_1", salesAssignedClientIds: [ids.clientA] });
const agent1 = () => makeActor("AGENT", { userId: ids.agent1User, agentProfileId: ids.agent1 });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2 });

describe("interview request lifecycle (Sections 5.4, 8.5)", () => {
  it("only shortlisted, approved candidates can be requested; request notifies the account manager and creates a task", async () => {
    await expect(createInterviewRequest(db, clientA(), { candidateIds: [ids.agent1], timezone: "America/Los_Angeles", role: "Appointment Setter" })).rejects.toThrow(NotFoundError);
    await addToShortlist(db, clientA(), ids.agent1);
    await addToShortlist(db, clientA(), ids.agent2);
    const reqId = await createRequirement(db, clientA(), { title: "Solar setters", role: "Appointment Setter", agentsRequired: 2, skills: [], software: [] });
    ids.requestId = await createInterviewRequest(db, clientA(), { candidateIds: [ids.agent1, ids.agent2], requirementId: reqId, timezone: "America/Los_Angeles", role: "Appointment Setter", schedule: "Mon-Fri 9-5 PST", preferredDate: "2026-10-01", preferredTime: "9:00 AM", notes: "Solar campaign" });
    const r = await getRequest(db, clientA(), ids.requestId);
    expect(r.request.status).toBe("REQUESTED");
    expect(await db.introduction.count({ where: { clientId: ids.clientA, firstEvent: "SHORTLIST" } })).toBe(2);
    expect((await db.clientRequirement.findUniqueOrThrow({ where: { id: reqId } })).status).toBe("IN_PROGRESS");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "sales_1", type: "INTERVIEW_REQUESTED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_INTERVIEW_REQUEST", assigneeUserId: "sales_1", status: "OPEN" } })).toBe(1);
  });

  it("client B and unrelated agents cannot read the request; the candidate sees no company name before scheduling", async () => {
    await expect(getRequest(db, clientB(), ids.requestId)).rejects.toThrow(NotFoundError);
    const stranger = makeActor("AGENT", { userId: "x", agentProfileId: "not-a-candidate" });
    await expect(getRequest(db, stranger, ids.requestId)).rejects.toThrow(NotFoundError);
    const mine = await getRequest(db, agent1(), ids.requestId);
    expect(mine.audience).toBe("AGENT");
    const view = mine.request as { companyName: string | null; role: string };
    expect(view.companyName).toBeNull();
    expect(view.role).toBe("Appointment Setter");
    const keys = collectKeys(mine.request);
    for (const k of ["notes", "salesNotes", "contactEmail", "contactName", "client", "preferredDate", "internalFeedback"]) expect(keys.has(k), k).toBe(false);
    expect(JSON.stringify(mine.request)).not.toContain("Acme");
  });

  it("sales reviews, proposes times (mediated message), client confirms, candidates respond", async () => {
    await expect(startSalesReview(db, makeActor("RECRUITER"), ids.requestId)).rejects.toThrow(ForbiddenError);
    await startSalesReview(db, sales(), ids.requestId);
    await proposeSlots(db, sales(), ids.requestId, "Proposed: Thu 2 Oct 9:00 or 10:00 AM PST.");
    expect((await getRequest(db, clientA(), ids.requestId)).request.status).toBe("CLIENT_CONFIRMATION");
    // Agents cannot see the client-facing proposal; the client can.
    expect((await listMessages(db, agent1(), ids.requestId)).length).toBe(0);
    expect((await listMessages(db, clientA(), ids.requestId))[0].authorLabel).toBe("Hirewise");
    await clientConfirmSlots(db, clientA(), ids.requestId, "9:00 works.");
    expect((await getRequest(db, clientA(), ids.requestId)).request.status).toBe("CANDIDATE_CONFIRMATION");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agent1User, type: "CANDIDATE_CONFIRMATION_REQUESTED" } })).toBe(1);
    await candidateRespond(db, agent1(), ids.requestId, "CONFIRMED");
    await candidateRespond(db, agent2(), ids.requestId, "DECLINED");
    await expect(candidateRespond(db, clientA(), ids.requestId, "CONFIRMED")).rejects.toThrow(ForbiddenError);
    const staffView = (await getRequest(db, sales(), ids.requestId)).request as { candidates: Array<{ status: string; legalName: string | null }> };
    expect(staffView.candidates.map((c) => c.status)).toEqual(["CONFIRMED", "DECLINED"]);
    // Sales does not see legal names before scheduling (Section 6 footnote 1).
    expect(staffView.candidates[0].legalName).toBeNull();
  });

  it("a client message with a phone number is held, flagged, and hidden from the agent; Sales can release it", async () => {
    const r = await postMessage(db, clientA(), ids.requestId, "Great, can Maria text me at +1 555 010 0199 before the call?");
    expect(r.held).toBe(true);
    expect(r.reasons).toContain("phone number");
    expect(await db.activityFlag.count({ where: { userId: ids.userA, rule: "CONTACT_INFO_IN_MESSAGE" } })).toBe(1);
    // Client-authored messages are CLIENT_AND_HIREWISE; agents never see them either way.
    expect((await listMessages(db, agent1(), ids.requestId)).some((m) => m.body.includes("text me"))).toBe(false);
    expect((await listMessages(db, clientA(), ids.requestId)).some((m) => m.heldForReview)).toBe(true);
    const held = await listHeldMessages(db, sales());
    expect(held.length).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "sales_1", type: "MESSAGE_HELD_FOR_REVIEW" } })).toBe(1);
    await reviewHeldMessage(db, sales(), held[0].id, "RELEASE");
    expect((await listHeldMessages(db, sales())).length).toBe(0);
    expect(await db.auditLog.count({ where: { action: "MESSAGE_RELEASED", entityId: held[0].id } })).toBe(1);
    // Rate talk from an agent is flagged but delivered to Hirewise.
    const a = await postMessage(db, agent1(), ids.requestId, "What is your hourly rate for this campaign?");
    expect(a.held).toBe(false);
    expect(a.rateTalk).toBe(true);
    expect(await db.activityFlag.count({ where: { userId: ids.agent1User, rule: "RATE_DISCUSSION_IN_MESSAGE" } })).toBe(1);
  });

  it("scheduling creates interviews, sets availability to INTERVIEWING, queues reminders, and discloses the company to the candidate", async () => {
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await expect(scheduleInterviews(db, makeActor("OPERATIONS"), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.agent1, scheduledAt: when, durationMin: 30, meetingLink: "https://meet.example/abc" }] })).rejects.toThrow(ForbiddenError);
    await scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.agent1, scheduledAt: when, durationMin: 30, meetingLink: "https://meet.example/abc" }, { agentProfileId: ids.agent2, scheduledAt: when, durationMin: 30, meetingLink: "" }] });
    const r = await getRequest(db, sales(), ids.requestId);
    expect(r.request.status).toBe("SCHEDULED");
    const staff = r.request as { interviews: Array<{ id: string; agentProfileId: string }>; candidates: Array<{ legalName: string | null }> };
    expect(staff.interviews.length).toBe(1); // the declined candidate is not scheduled
    expect(staff.candidates[0].legalName).toBe("Maria S. Legal"); // disclosed to Sales once scheduled
    ids.interviewId = staff.interviews[0].id;
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent1 } })).availabilityStatus).toBe("INTERVIEWING");
    expect(await db.job.count({ where: { type: "INTERVIEW_REMINDER", status: "PENDING" } })).toBe(2);
    const mine = await getRequest(db, agent1(), ids.requestId);
    expect((mine.request as { companyName: string | null }).companyName).toBe("Acme Solar");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agent1User, type: "INTERVIEW_SCHEDULED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.userA, type: "INTERVIEW_SCHEDULED" } })).toBe(1);
  });

  it("completing the last interview moves the request to CLIENT_DECISION_PENDING; decisions are the client's alone", async () => {
    await expect(recordClientDecision(db, clientA(), ids.interviewId, { decision: "SELECTED" })).rejects.toThrow(/once all interviews are complete/);
    await completeInterview(db, sales(), ids.interviewId, "COMPLETED", "Strong call handling");
    expect((await getRequest(db, clientA(), ids.requestId)).request.status).toBe("CLIENT_DECISION_PENDING");
    await expect(recordClientDecision(db, clientB(), ids.interviewId, { decision: "SELECTED" })).rejects.toThrow(NotFoundError);
    await expect(recordClientDecision(db, sales(), ids.interviewId, { decision: "SELECTED" })).rejects.toThrow(NotFoundError);
  });

  it("SELECTED creates a placement, reserves the candidate, notifies staff and agent, and closes the request", async () => {
    await recordClientDecision(db, clientA(), ids.interviewId, { decision: "SELECTED", feedback: "Great fit" });
    const placements = await listPlacementsForClient(db, clientA());
    expect(placements.length).toBe(1);
    expect(placements[0].status).toBe("SELECTED");
    expect(placements[0].agent.displayName).toBe("Maria S.");
    expect((await listPlacementsForAgent(db, agent1()))[0].client.companyName).toBe("Acme Solar");
    expect((await listPlacementsForStaff(db, sales())).length).toBe(1);
    await expect(listPlacementsForStaff(db, makeActor("COACH"))).rejects.toThrow(ForbiddenError);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent1 } })).availabilityStatus).toBe("RESERVED");
    expect(await db.reservation.count({ where: { agentProfileId: ids.agent1, status: "ACTIVE" } })).toBe(1);
    expect((await getRequest(db, clientA(), ids.requestId)).request.status).toBe("CLOSED");
    expect(await db.auditLog.count({ where: { action: "CANDIDATE_SELECTED" } })).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agent1User, type: "CANDIDATE_SELECTED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: "admin_1", type: "CANDIDATE_SELECTED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "FINALISE_PLACEMENT", assigneeUserId: "sales_1" } })).toBe(1);
    // The unscheduled candidate goes back to AVAILABLE; the selected one stays reserved.
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent2 } })).availabilityStatus).toBe("AVAILABLE");
    // Closed threads take no more messages.
    await expect(postMessage(db, clientA(), ids.requestId, "Thanks!")).rejects.toThrow(/closed/i);
  });

  it("staff list shows the request; Sales sees the candidate's legal name after scheduling but never the email", async () => {
    const rows = await listRequestsForStaff(db, sales(), "all");
    expect(rows.length).toBe(1);
    expect(rows[0].candidates[0].email).toBeNull();
    const ops = await listRequestsForStaff(db, makeActor("OPERATIONS", { userId: "ops_1" }), "all");
    expect(ops[0].candidates[0].email).toBe("a1@t.example");
  });
});

describe("reservations (Section 5.8)", () => {
  it("one active reservation per agent; another client cannot reserve the same agent", async () => {
    await expect(reserveForClient(db, sales(), { agentProfileId: ids.agent1, clientId: ids.clientB, reason: "x" })).rejects.toThrow(AlreadyReservedError);
    await expect(reserveForClient(db, makeActor("RECRUITER"), { agentProfileId: ids.agent2, clientId: ids.clientB })).rejects.toThrow(ForbiddenError);
  });

  it("expiry restores the availability that was in force before the reservation (fake clock)", async () => {
    const res = await db.reservation.findFirstOrThrow({ where: { agentProfileId: ids.agent1, status: "ACTIVE" } });
    expect(await expireReservations(db, new Date(res.expiresAt.getTime() - 60_000))).toBe(0);
    await extendReservation(db, sales(), res.id, 3);
    const extended = await db.reservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(extended.status).toBe("EXTENDED");
    expect(extended.expiresAt.getTime()).toBeGreaterThan(res.expiresAt.getTime());
    expect(await expireReservations(db, new Date(res.expiresAt.getTime() + 60_000))).toBe(0);
    expect(await expireReservations(db, new Date(extended.expiresAt.getTime() + 60_000))).toBe(1);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("EXPIRED");
    // Before the reservation the agent was INTERVIEWING (set at scheduling), so that is restored.
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent1 } })).availabilityStatus).toBe("INTERVIEWING");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "sales_1", type: "RESERVATION_EXPIRED" } })).toBe(1);
  });

  it("manual reserve and release by Sales", async () => {
    const r = await reserveForClient(db, sales(), { agentProfileId: ids.agent2, clientId: ids.clientA, reason: "Verbal commitment" });
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent2 } })).availabilityStatus).toBe("RESERVED");
    await releaseReservation(db, sales(), r.id, "Client paused");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent2 } })).availabilityStatus).toBe("AVAILABLE");
  });
});

describe("cancellation", () => {
  it("client cancels their own scheduled request with a reason; agents return to AVAILABLE", async () => {
    await addToShortlist(db, clientB(), ids.agent2);
    const id = await createInterviewRequest(db, clientB(), { candidateIds: [ids.agent2], timezone: "Australia/Sydney", role: "Setter" });
    await expect(cancelRequest(db, clientA(), id, "not mine")).rejects.toThrow(NotFoundError);
    await expect(cancelRequest(db, clientB(), id, "")).rejects.toThrow(/reason/i);
    await cancelRequest(db, clientB(), id, "Role filled internally");
    expect((await getRequest(db, clientB(), id)).request.status).toBe("CANCELLED");
  });
});
