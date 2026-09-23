import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { proposeBillingRate, decideBillingRate, retireBillingRate, billingRatesForAgent, setCompensation, currentCompensationFor, compensationHistoryFor, clientRatePublishedFor } from "@/server/services/rate.service";
import { approvePlacement, serviceAgreementFor, acceptServiceAgreement, activatePlacement, setChecklistItem, setStartDate, transitionPlacement, getPlacementForClient, getPlacementForAgent, getPlacementForStaff, DepositUnpaidError } from "@/server/services/placement.service";
import { recordPayment, waiveDeposit, changeDepositPolicy, getInvoiceForClient, listInvoicesForClient, invoicePdfUrl, voidInvoice } from "@/server/services/billing.service";
import { revenueReport, marginReport, pipelineReport, parseRange } from "@/server/services/report.service";
import { getCandidateForClient } from "@/server/services/search.service";
import { getOwnProfile } from "@/server/services/agent.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { IllegalTransitionError } from "@/server/state/placement";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { collectKeys, FORBIDDEN_FOR_AGENT, FORBIDDEN_FOR_CLIENT } from "@/server/views/forbidden-keys";

const db = testDb();
let dir = "";
const ids = { owner: "owner_1", admin: "admin_1", sales: "sales_1", ops: "ops_1", clientUserA: "", clientA: "", clientUserB: "", clientB: "", agentUser: "", agent: "", placement: "", rate: "", invoice: "", deposit: "", policyOneMonth: "", policyFixed: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-com-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.setting.create({ data: { key: "hoursPerMonthDefault", value: 173 } });
  await db.setting.create({ data: { key: "reservationTtlDays", value: 7 } });
  await db.user.create({ data: { id: ids.owner, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: ids.ops, email: "ops@hirewise.example", roleId: await role("OPERATIONS") } });
  const uA = await db.user.create({ data: { email: "a@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "b@beta.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.clientUserA = uA.id;
  ids.clientUserB = uB.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: ids.sales, contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.clientB = (await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "Sam", businessEmail: uB.email, isPrimary: true } } } })).id;
  const au = await db.user.create({ data: { email: "agent@t.example", roleId: await role("AGENT") } });
  ids.agentUser = au.id;
  ids.agent = (await db.agentProfile.create({ data: { userId: au.id, displayName: "Jose R.", headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "RESERVED", timezone: "Asia/Manila", approvedAt: new Date(), languages: ["English"], privateContact: { create: { fullLegalName: "Jose Ramos", phone: "+63" } }, availabilityHistory: { create: [{ status: "AVAILABLE", setById: ids.admin, setAt: new Date(Date.now() - 86_400_000) }, { status: "RESERVED", setById: ids.sales }] } } })).id;
  ids.placement = (await db.placement.create({ data: { clientId: ids.clientA, agentProfileId: ids.agent, positionTitle: "Cold Caller", schedule: "Mon-Fri 9-6 PST", timezone: "America/Los_Angeles", status: "SELECTED", accountManagerUserId: ids.sales } })).id;
  await db.reservation.create({ data: { agentProfileId: ids.agent, clientId: ids.clientA, placementId: ids.placement, reservedById: ids.sales, expiresAt: new Date(Date.now() + 7 * 86_400_000), status: "ACTIVE" } });
  ids.policyOneMonth = (await db.depositPolicy.create({ data: { name: "One month", type: "ONE_MONTH", isDefault: true } })).id;
  ids.policyFixed = (await db.depositPolicy.create({ data: { name: "Fixed 500", type: "FIXED", value: 50_000, currency: "USD" } })).id;
  const body = "# PSA\n\nBetween Hirewise and {{companyName}} for {{agentName}} as {{positionTitle}} at {{billingRate}}, deposit {{deposit}}, start {{startDate}}.";
  await db.agreement.create({ data: { type: "PLACEMENT_SERVICE_AGREEMENT", version: 1, title: "Placement Service Agreement", bodyMarkdown: body, bodyChecksum: "x", effectiveFrom: new Date("2026-01-01"), isActive: true } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const owner = () => makeActor("SUPER_ADMIN", { userId: ids.owner });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales, salesAssignedClientIds: [ids.clientA] });
const ops = () => makeActor("OPERATIONS", { userId: ids.ops });
const clientA = () => makeActor("CLIENT", { userId: ids.clientUserA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.clientUserB, clientId: ids.clientB });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agent });

describe("client billing rates (INV-C2, C3, C4)", () => {
  it("Sales proposes; the proposal is PENDING_APPROVAL with a history row; agents and clients cannot propose", async () => {
    ids.rate = await proposeBillingRate(db, sales(), { agentProfileId: ids.agent, amountUsd: "9.00", currency: "USD", unit: "HOURLY", positioningNotes: "" });
    const r = await db.clientBillingRate.findUniqueOrThrow({ where: { id: ids.rate } });
    expect([r.status, r.amount]).toEqual(["PENDING_APPROVAL", 900]);
    expect(await db.rateHistory.count({ where: { subjectId: ids.rate } })).toBe(1);
    await expect(proposeBillingRate(db, agent(), { agentProfileId: ids.agent, amountUsd: "1", currency: "USD", unit: "HOURLY" })).rejects.toThrow(ForbiddenError);
    await expect(proposeBillingRate(db, clientA(), { agentProfileId: ids.agent, amountUsd: "1", currency: "USD", unit: "HOURLY" })).rejects.toThrow(ForbiddenError);
    await expect(proposeBillingRate(db, ops(), { agentProfileId: ids.agent, amountUsd: "1", currency: "USD", unit: "HOURLY" })).rejects.toThrow(ForbiddenError);
  });

  it("Sales cannot publish a rate; Admin can, and publishing retires the previous one with history", async () => {
    await expect(decideBillingRate(db, sales(), ids.rate, "PUBLISH")).rejects.toThrow(ForbiddenError);
    await expect(approvePlacement(db, admin(), ids.placement)).rejects.toThrow(/PUBLISHED client billing rate/);
    await decideBillingRate(db, admin(), ids.rate, "PUBLISH");
    expect((await db.clientBillingRate.findUniqueOrThrow({ where: { id: ids.rate } })).status).toBe("PUBLISHED");
    // second proposal supersedes
    const r2 = await proposeBillingRate(db, admin(), { agentProfileId: ids.agent, amountUsd: "9.50", currency: "USD", unit: "HOURLY", positioningNotes: "Solar campaign premium" });
    await decideBillingRate(db, admin(), r2, "PUBLISH", "Market adjustment");
    const rows = await db.clientBillingRate.findMany({ where: { agentProfileId: ids.agent }, orderBy: { createdAt: "asc" } });
    expect(rows.map((x) => x.status)).toEqual(["RETIRED", "PUBLISHED"]);
    expect(rows[0].effectiveTo).not.toBeNull();
    // INV-C4: every change has a history row (propose, publish, supersede-retire, propose, publish)
    expect(await db.rateHistory.count({ where: { agentProfileId: ids.agent, subjectType: "CLIENT_BILLING_RATE" } })).toBe(5);
    ids.rate = r2;
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "CLIENT_RATE_PUBLISHED" } })).toBeGreaterThan(0);
    const agentNotice = await db.notification.findFirst({ where: { userId: ids.agentUser, type: "CLIENT_RATE_PUBLISHED" } });
    expect(agentNotice?.body).not.toMatch(/9\.\d0/);
  });

  it("Sales sees the published rate and pending proposals but no history or positioning notes (footnote 7); Admin sees all", async () => {
    const s = await billingRatesForAgent(db, sales(), ids.agent);
    expect(s.published?.amount).toBe(950);
    expect(s.published?.positioningNotes).toBeNull();
    expect(s.history).toEqual([]);
    const a = await billingRatesForAgent(db, admin(), ids.agent);
    expect(a.published?.positioningNotes).toBe("Solar campaign premium");
    expect(a.history.length).toBe(5);
    await expect(billingRatesForAgent(db, makeActor("RECRUITER"), ids.agent)).rejects.toThrow(ForbiddenError);
  });

  it("clients see the PUBLISHED amount on the candidate; the agent sees only a boolean flag", async () => {
    const { candidate } = await getCandidateForClient(db, clientA(), ids.agent);
    expect(candidate.clientRate).toEqual({ amount: 950, currency: "USD", unit: "HOURLY", label: "USD 9.50 / hour" });
    const self = await getOwnProfile(db, agent());
    expect(self.clientRatePublished).toBe(true);
    const keys = collectKeys(self);
    for (const k of ["clientRate", "billingRate", "clientBillingRateId", "amount", "positioningNotes"]) expect(keys.has(k), k).toBe(false);
    expect(await clientRatePublishedFor(db, ids.agent)).toBe(true);
  });

  it("rejecting needs a reason; retiring needs billing_rate.approve", async () => {
    const r3 = await proposeBillingRate(db, sales(), { agentProfileId: ids.agent, amountUsd: "12", currency: "USD", unit: "HOURLY" });
    await expect(decideBillingRate(db, admin(), r3, "REJECT")).rejects.toThrow(/reason/);
    await decideBillingRate(db, admin(), r3, "REJECT", "Too high for the band");
    expect((await db.clientBillingRate.findUniqueOrThrow({ where: { id: r3 } })).status).toBe("RETIRED");
    await expect(retireBillingRate(db, sales(), ids.rate, "x")).rejects.toThrow(ForbiddenError);
  });
});

describe("agent compensation (INV-C1)", () => {
  it("only compensation.write can set it; the agent reads their own; Admin without override cannot read", async () => {
    await expect(setCompensation(db, admin(), { agentProfileId: ids.agent, amountUsd: "5", currency: "USD", unit: "HOURLY" })).rejects.toThrow(ForbiddenError);
    await expect(setCompensation(db, sales(), { agentProfileId: ids.agent, amountUsd: "5", currency: "USD", unit: "HOURLY" })).rejects.toThrow(ForbiddenError);
    await setCompensation(db, owner(), { agentProfileId: ids.agent, amountUsd: "5.00", currency: "USD", unit: "HOURLY", notes: "Starting band" }, "Initial");
    await setCompensation(db, owner(), { agentProfileId: ids.agent, amountUsd: "5.50", currency: "USD", unit: "HOURLY" }, "Raise");
    const mine = await currentCompensationFor(db, agent(), ids.agent);
    expect(mine?.amount).toBe(550);
    expect(mine?.notes).toBeNull();
    await expect(currentCompensationFor(db, admin(), ids.agent)).rejects.toThrow(ForbiddenError);
    await expect(currentCompensationFor(db, clientA(), ids.agent)).rejects.toThrow(ForbiddenError);
    await expect(currentCompensationFor(db, makeActor("AGENT", { agentProfileId: "other" }), ids.agent)).rejects.toThrow(ForbiddenError);
    const h = await compensationHistoryFor(db, owner(), ids.agent);
    expect(h.records.map((r) => r.amount)).toEqual([550, 500]);
    expect(h.history).toHaveLength(2);
    expect(h.records[1].effectiveTo).not.toBeNull();
  });

  it("an Admin with a compensation.read override can read", async () => {
    const withOverride = makeActor("ADMIN", { userId: ids.admin, overrides: [{ permission: "compensation.read", expiresAt: null }] });
    expect((await currentCompensationFor(db, withOverride, ids.agent))?.amount).toBe(550);
  });
});

describe("placement pipeline (Section 5.5 guards, INV-C5)", () => {
  it("approval needs placement.approve; it snapshots the rate, creates the deposit from the default policy, and issues the invoice", async () => {
    await expect(approvePlacement(db, sales(), ids.placement)).rejects.toThrow(ForbiddenError);
    await approvePlacement(db, admin(), ids.placement, { startDate: "2026-11-02" });
    const p = await db.placement.findUniqueOrThrow({ where: { id: ids.placement }, include: { deposit: true, invoices: true } });
    expect(p.status).toBe("AWAITING_AGREEMENT");
    expect(p.clientBillingRateId).toBe(ids.rate);
    expect(p.agentCompensationId).not.toBeNull();
    expect(p.deposit?.requiredAmount).toBe(950 * 173);
    expect(p.invoices).toHaveLength(1);
    expect(p.invoices[0].number).toMatch(/^HW-\d{4}-00001$/);
    ids.deposit = p.deposit!.id;
    ids.invoice = p.invoices[0].id;
    await expect(approvePlacement(db, admin(), ids.placement)).rejects.toThrow(IllegalTransitionError);
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.clientUserA, type: "PLACEMENT_APPROVED" } })).toBe(1);
  });

  it("the client sees the rate snapshot, deposit, and own invoices; the agent sees compensation only; other clients get NotFound", async () => {
    const c = await getPlacementForClient(db, clientA(), ids.placement);
    expect(c.billingRate?.label).toBe("USD 9.50 / hour");
    expect(c.deposit?.status).toBe("PENDING");
    expect(c.invoices).toHaveLength(1);
    const ck = collectKeys(c);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(ck.has(k), k).toBe(false);
    await expect(getPlacementForClient(db, clientB(), ids.placement)).rejects.toThrow(NotFoundError);

    const a = await getPlacementForAgent(db, agent(), ids.placement);
    expect(a.compensation?.label).toBe("USD 5.50 / hour");
    expect(a.clientRatePublished).toBe(true);
    const ak = collectKeys(a);
    for (const k of FORBIDDEN_FOR_AGENT) expect(ak.has(k), k).toBe(false);
    expect(ak.has("billingRate")).toBe(false);

    const s = await getPlacementForStaff(db, sales(), ids.placement);
    expect(s.billingRate?.amount).toBe(950);
    expect(s.compensation).toBeNull();
    const su = await getPlacementForStaff(db, owner(), ids.placement);
    expect(su.compensation?.amount).toBe(550);
    await expect(getPlacementForStaff(db, makeActor("SALES", { salesAssignedClientIds: [ids.clientB] }), ids.placement)).rejects.toThrow(ForbiddenError);
  });

  it("the client accepts the rendered service agreement with placementId; the deposit becomes due", async () => {
    const rendered = await serviceAgreementFor(db, clientA(), ids.placement);
    expect(rendered.bodyMarkdown).toContain("Acme Solar");
    expect(rendered.bodyMarkdown).toContain("USD 9.50 / hour");
    expect(rendered.bodyMarkdown).toContain("2026-11-02");
    await expect(acceptServiceAgreement(db, clientB(), ids.placement, {})).rejects.toThrow(NotFoundError);
    await acceptServiceAgreement(db, clientA(), ids.placement, { ipAddress: "10.0.0.1", userAgent: "vitest" });
    const p = await db.placement.findUniqueOrThrow({ where: { id: ids.placement } });
    expect(p.status).toBe("AWAITING_DEPOSIT");
    const acc = await db.agreementAcceptance.findFirst({ where: { placementId: ids.placement } });
    expect(acc?.bodyChecksum).toBe(rendered.checksum);
    expect(acc?.ipAddress).toBe("10.0.0.1");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.clientUserA, type: "DEPOSIT_REQUIRED" } })).toBe(1);
  });

  it("ACTIVE is unreachable with an unpaid deposit for every role, including Super Admin", async () => {
    // Force DEPLOYMENT_PREP without paying to isolate the activation guard.
    await db.placement.update({ where: { id: ids.placement }, data: { status: "DEPLOYMENT_PREP" } });
    await db.deploymentChecklistItem.createMany({ data: [{ placementId: ids.placement, order: 1, label: "Equipment", isRequired: true, isDone: true }] });
    await expect(activatePlacement(db, owner(), ids.placement)).rejects.toThrow(DepositUnpaidError);
    await expect(activatePlacement(db, admin(), ids.placement)).rejects.toThrow(DepositUnpaidError);
    await expect(activatePlacement(db, ops(), ids.placement)).rejects.toThrow(DepositUnpaidError);
    await expect(activatePlacement(db, sales(), ids.placement)).rejects.toThrow(ForbiddenError);
    expect((await db.placement.findUniqueOrThrow({ where: { id: ids.placement } })).status).toBe("DEPLOYMENT_PREP");
    await db.deploymentChecklistItem.deleteMany({ where: { placementId: ids.placement } });
    await db.placement.update({ where: { id: ids.placement }, data: { status: "AWAITING_DEPOSIT" } });
  });

  it("waiving needs deposit.override and a reason; Sales and Operations cannot waive", async () => {
    await expect(waiveDeposit(db, sales(), ids.deposit, "please")).rejects.toThrow(ForbiddenError);
    await expect(waiveDeposit(db, ops(), ids.deposit, "please")).rejects.toThrow(ForbiddenError);
    await expect(waiveDeposit(db, admin(), ids.deposit, "  ")).rejects.toThrow(/reason/);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: ids.deposit } })).status).toBe("PENDING");
  });

  it("Sales may recalculate an unpaid deposit with another policy; the old invoice is voided", async () => {
    await changeDepositPolicy(db, sales(), ids.deposit, ids.policyFixed);
    const dep = await db.deposit.findUniqueOrThrow({ where: { id: ids.deposit }, include: { invoices: { orderBy: { issuedAt: "asc" } } } });
    expect(dep.requiredAmount).toBe(50_000);
    expect(dep.invoices.map((i) => i.status)).toEqual(["VOID", "ISSUED"]);
    ids.invoice = dep.invoices[1].id;
  });

  it("only payment.record can record; a partial payment leaves the deposit PARTIALLY_PAID; full payment moves to DEPLOYMENT_PREP and seeds the checklist", async () => {
    await expect(recordPayment(db, clientA(), { invoiceId: ids.invoice, amountUsd: "500", method: "BANK_TRANSFER" })).rejects.toThrow(ForbiddenError);
    await expect(recordPayment(db, ops(), { invoiceId: ids.invoice, amountUsd: "500", method: "BANK_TRANSFER" })).rejects.toThrow(ForbiddenError);
    const first = await recordPayment(db, sales(), { invoiceId: ids.invoice, amountUsd: "200", method: "BANK_TRANSFER", reference: "WIRE-1" });
    expect(first).toMatchObject({ invoicePaid: false, depositSettled: false });
    expect((await db.deposit.findUniqueOrThrow({ where: { id: ids.deposit } })).status).toBe("PARTIALLY_PAID");
    const second = await recordPayment(db, sales(), { invoiceId: ids.invoice, amountUsd: "300", method: "PAYPAL", reference: "PP-2" });
    expect(second).toMatchObject({ invoicePaid: true, depositSettled: true });
    const p = await db.placement.findUniqueOrThrow({ where: { id: ids.placement }, include: { checklistItems: true, deposit: true } });
    expect(p.status).toBe("DEPLOYMENT_PREP");
    expect(p.deposit?.status).toBe("PAID");
    expect(p.checklistItems.length).toBeGreaterThanOrEqual(5);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: ids.invoice } })).status).toBe("PAID");
    await expect(recordPayment(db, sales(), { invoiceId: ids.invoice, amountUsd: "1", method: "OTHER" })).rejects.toThrow(/already paid/);
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(0);
    const agentNotice = await db.notification.findFirst({ where: { userId: ids.agentUser, type: "DEPOSIT_PAID" } });
    expect(agentNotice).not.toBeNull();
    expect(agentNotice?.body).not.toMatch(/USD|\$/);
    expect(await db.task.count({ where: { type: "DEPLOY_AGENT", status: "OPEN" } })).toBe(1);
  });

  it("activation needs every required checklist item and a start date; then availability becomes PLACED and the hold converts", async () => {
    await expect(activatePlacement(db, ops(), ids.placement)).rejects.toThrow(/checklist/);
    const items = await db.deploymentChecklistItem.findMany({ where: { placementId: ids.placement } });
    await expect(setChecklistItem(db, sales(), items[0].id, true)).resolves.toBeUndefined();
    await expect(setChecklistItem(db, clientA(), items[0].id, true)).rejects.toThrow(ForbiddenError);
    for (const it of items) if (it.isRequired) await setChecklistItem(db, ops(), it.id, true);
    await db.placement.update({ where: { id: ids.placement }, data: { startDate: null } });
    await expect(activatePlacement(db, ops(), ids.placement)).rejects.toThrow(/start date/);
    await setStartDate(db, sales(), ids.placement, "2026-11-09");
    await activatePlacement(db, ops(), ids.placement);
    const p = await db.placement.findUniqueOrThrow({ where: { id: ids.placement }, include: { agentProfile: true } });
    expect(p.status).toBe("ACTIVE");
    expect(p.activatedAt).not.toBeNull();
    expect(p.agentProfile.availabilityStatus).toBe("PLACED");
    expect((await db.reservation.findFirst({ where: { placementId: ids.placement } }))?.status).toBe("CONVERTED");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { type: "CANDIDATE_DEPLOYED" } })).toBeGreaterThanOrEqual(3);
    expect(await db.task.count({ where: { type: "DEPLOY_AGENT", status: "OPEN" } })).toBe(0);
  });

  it("pause and resume need a reason to pause; completion restores availability", async () => {
    await expect(transitionPlacement(db, ops(), ids.placement, "PAUSED")).rejects.toThrow(/reason/);
    await transitionPlacement(db, ops(), ids.placement, "PAUSED", "Client holiday");
    await transitionPlacement(db, ops(), ids.placement, "ACTIVE");
    await expect(transitionPlacement(db, agent(), ids.placement, "COMPLETED", "x")).rejects.toThrow(ForbiddenError);
  });
});

describe("invoices and reports", () => {
  it("a client sees only their own invoices; direct access to another client's invoice is NotFound", async () => {
    const mine = await listInvoicesForClient(db, clientA());
    expect(mine.length).toBe(2);
    const detail = await getInvoiceForClient(db, clientA(), ids.invoice);
    expect(detail.invoice.status).toBe("PAID");
    expect(detail.invoice.payments).toHaveLength(2);
    await expect(getInvoiceForClient(db, clientB(), ids.invoice)).rejects.toThrow(NotFoundError);
    expect(await listInvoicesForClient(db, clientB())).toEqual([]);
    await expect(invoicePdfUrl(db, clientB(), ids.invoice)).rejects.toThrow(NotFoundError);
    const url = await invoicePdfUrl(db, clientA(), ids.invoice);
    expect(decodeURIComponent(url)).toContain("invoices/");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: ids.invoice } })).pdfKey).toMatch(/\.pdf$/);
    await expect(voidInvoice(db, sales(), ids.invoice, "x")).rejects.toThrow(/paid/);
  });

  it("revenue report is billing-side; margin requires compensation.read and billing_rate.read (INV-C1)", async () => {
    const range = parseRange("2026-01-01", "2026-12-31");
    const rev = await revenueReport(db, sales(), range);
    expect(rev.placements).toHaveLength(1);
    expect(rev.monthlyRunRate).toBe(950 * 173);
    expect(rev.collectedInRange).toBe(50_000);
    expect(collectKeys(rev).has("monthlyCompensation")).toBe(false);
    await expect(revenueReport(db, ops(), range)).rejects.toThrow(ForbiddenError);
    await expect(marginReport(db, admin())).rejects.toThrow(ForbiddenError);
    await expect(marginReport(db, sales())).rejects.toThrow(ForbiddenError);
    const m = await marginReport(db, owner());
    expect(m.rows[0]).toMatchObject({ monthlyBilling: 950 * 173, monthlyCompensation: 550 * 173, margin: 400 * 173 });
    const withOverride = makeActor("ADMIN", { userId: ids.admin, overrides: [{ permission: "compensation.read", expiresAt: null }] });
    expect((await marginReport(db, withOverride)).rows).toHaveLength(1);
    const pipe = await pipelineReport(db, sales(), range);
    expect(pipe.active).toBe(1);
    await expect(pipelineReport(db, makeActor("COACH"), range)).rejects.toThrow(ForbiddenError);
  });
});
