import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError } from "@/server/policies/authorize";
import { placementRepository } from "@/server/repositories/placement.repository";
import { billingRepository } from "@/server/repositories/billing.repository";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { monthlyEquivalent } from "@/server/state/placement";
import { getSetting } from "./setting.service";
import { money } from "@/server/views/commercial.views";

/** Section 11 reports. Each function authorizes for its own role list. */

export type DateRange = { from: Date; to: Date };

export function parseRange(from?: string, to?: string): DateRange {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 90 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid date range.");
  end.setHours(23, 59, 59, 999);
  return { from: start, to: end };
}

/** Shortlists → interview requests → selections → deposits → active (AD, SA). */
export async function pipelineReport(db: PrismaClient, actor: Actor, range: DateRange) {
  authorize(actor, "report.pipeline");
  const [requests, placements, byStatus] = await Promise.all([
    interviewRepository.countByStatus(db),
    placementRepository.countCreatedBetween(db, range.from, range.to),
    placementRepository.countByStatus(db),
  ]);
  const by = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const totalRequests = requests.reduce((s, r) => s + r._count._all, 0);
  const deposits = await db.deposit.count({ where: { status: { in: ["PAID", "WAIVED"] }, createdAt: { gte: range.from, lte: range.to } } });
  return {
    range,
    interviewRequests: totalRequests,
    selectionsInRange: placements,
    depositsSettledInRange: deposits,
    active: by.ACTIVE ?? 0,
    awaitingAgreement: by.AWAITING_AGREEMENT ?? 0,
    awaitingDeposit: by.AWAITING_DEPOSIT ?? 0,
    deploymentPrep: by.DEPLOYMENT_PREP ?? 0,
    completed: by.COMPLETED ?? 0,
    cancelled: by.CANCELLED ?? 0,
    conversion: { selectionToDeposit: placements ? Math.round((deposits / placements) * 100) : 0 },
  };
}

/** Billing side only (report.revenue). Never touches compensation (INV-C1). */
export async function revenueReport(db: PrismaClient, actor: Actor, range: DateRange) {
  authorize(actor, "report.revenue");
  authorize(actor, "billing_rate.read");
  const hours = await getSetting(db, "hoursPerMonthDefault");
  const placements = await placementRepository.listByStatuses(db, ["ACTIVE", "PAUSED"]);
  const rows = placements
    .filter((p) => p.clientBillingRate)
    .map((p) => ({ placementId: p.id, client: p.client.companyName, agent: p.agentProfile.displayName, position: p.positionTitle, status: p.status, rate: p.clientBillingRate!, monthlyBilling: monthlyEquivalent(p.clientBillingRate!, hours), currency: p.clientBillingRate!.currency, activatedAt: p.activatedAt }));
  const payments = await billingRepository.paidBetween(db, range.from, range.to);
  const collected = payments.reduce((s, p) => s + p.amount, 0);
  return {
    range,
    hoursPerMonth: hours,
    placements: rows.map((r) => ({ ...r, monthlyBillingLabel: money(r.monthlyBilling, r.currency), rateLabel: `${money(r.rate.amount, r.rate.currency)} / ${r.rate.unit === "HOURLY" ? "hour" : "month"}` })),
    monthlyRunRate: rows.reduce((s, r) => s + r.monthlyBilling, 0),
    collectedInRange: collected,
    paymentsInRange: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, amount: p.amount, currency: p.currency, method: p.method, reference: p.reference, invoiceNumber: p.invoice.number, client: p.invoice.client.companyName })),
  };
}

/**
 * Margin joins the two rate tables, so it requires compensation.read AND billing_rate.read
 * on top of report.revenue (INV-C1). Admin gets it only through a Super Admin override.
 */
export async function marginReport(db: PrismaClient, actor: Actor) {
  authorize(actor, "report.revenue");
  if (!actor.permissions.has("compensation.read") || !actor.permissions.has("billing_rate.read")) throw new ForbiddenError("Margin requires compensation.read and billing_rate.read", "compensation.read");
  const hours = await getSetting(db, "hoursPerMonthDefault");
  const placements = await placementRepository.listByStatuses(db, ["ACTIVE", "PAUSED"]);
  const rows = placements
    .filter((p) => p.clientBillingRate)
    .map((p) => {
      const billing = monthlyEquivalent(p.clientBillingRate!, hours);
      const comp = p.agentCompensation ? monthlyEquivalent(p.agentCompensation, hours) : null;
      const margin = comp === null ? null : billing - comp;
      return { placementId: p.id, client: p.client.companyName, agent: p.agentProfile.displayName, status: p.status, currency: p.clientBillingRate!.currency, monthlyBilling: billing, monthlyCompensation: comp, margin, marginPct: margin === null || billing === 0 ? null : Math.round((margin / billing) * 1000) / 10, compensationCurrency: p.agentCompensation?.currency ?? null };
    });
  return { hoursPerMonth: hours, rows, totals: { billing: rows.reduce((s, r) => s + r.monthlyBilling, 0), compensation: rows.reduce((s, r) => s + (r.monthlyCompensation ?? 0), 0), margin: rows.reduce((s, r) => s + (r.margin ?? 0), 0) } };
}

/** CSV helper for the /reports export routes. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
