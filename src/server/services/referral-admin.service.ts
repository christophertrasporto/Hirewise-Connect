import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { referralRepository } from "@/server/repositories/referral.repository";
import { settingRepository } from "@/server/repositories/setting.repository";
import { audit } from "@/server/audit/audit";
import { getSetting, SETTING_SCHEMAS } from "./setting.service";
import { balanceFor } from "./commission.service";

/** Staff side of the referral program (referral.manage): settings, the affiliates list, one affiliate's ledger, and flags. */

export async function getReferralSettings(db: PrismaClient, actor: Actor) {
  authorize(actor, "referral.manage");
  return getSetting(db, "referrals");
}

/** Changing the rate only affects future sales: every commission stores the rate it was made at. */
export async function updateReferralSettings(db: PrismaClient, actor: Actor, raw: z.input<typeof SETTING_SCHEMAS.referrals>, reason?: string) {
  authorize(actor, "referral.manage");
  const next = SETTING_SCHEMAS.referrals.parse(raw);
  await db.$transaction(async (tx) => {
    const previous = await settingRepository.get(tx, "referrals");
    await settingRepository.upsert(tx, "referrals", next, actor.userId);
    await audit(tx, { actor, action: "REFERRAL_SETTINGS_SET", entityType: "Setting", entityId: "referrals", previousValue: previous?.value, newValue: next, reason });
  });
  return next;
}

export async function listAffiliates(db: PrismaClient, actor: Actor) {
  authorize(actor, "referral.manage");
  const settings = await getSetting(db, "referrals");
  const agg = await referralRepository.affiliateRows(db);
  const ids = new Set<string>();
  for (const r of agg.clicks) ids.add(r.referrerId);
  for (const r of agg.signups) if (r.referredByUserId) ids.add(r.referredByUserId);
  for (const r of agg.commissions) ids.add(r.referrerId);
  const users = await referralRepository.usersByIds(db, [...ids]);
  const names = await referralRepository.namesFor(db, [...ids]);
  const rows = users.map((u) => {
    const c = agg.commissions.filter((x) => x.referrerId === u.id);
    const sum = (status: string) => c.filter((x) => x.status === status).reduce((n, x) => n + (x._sum.commissionAmount ?? 0), 0);
    return {
      userId: u.id,
      email: u.email,
      name: names.get(u.id) ?? null,
      role: u.role.key,
      code: u.referralCode,
      clicks: agg.clicks.find((x) => x.referrerId === u.id)?._count._all ?? 0,
      signups: agg.signups.find((x) => x.referredByUserId === u.id)?._count._all ?? 0,
      sales: c.filter((x) => x.status !== "REVERSED").reduce((n, x) => n + x._count._all, 0),
      onHold: sum("ON_HOLD"),
      payable: sum("PAYABLE"),
      paid: agg.payouts.find((x) => x.referrerId === u.id)?._sum.amount ?? 0,
      openFlags: agg.flags.find((x) => x.referrerId === u.id)?._count._all ?? 0,
    };
  });
  rows.sort((a, b) => b.openFlags - a.openFlags || b.sales - a.sales || b.signups - a.signups);
  return { rows, currency: settings.payoutCurrency };
}

export async function affiliateDetail(db: PrismaClient, actor: Actor, userId: string) {
  authorize(actor, "referral.manage");
  const user = await referralRepository.userBasics(db, userId);
  if (!user) throw new NotFoundError();
  const settings = await getSetting(db, "referrals");
  const [commissions, adjustments, flags, payouts, referred, balance, name] = await Promise.all([
    referralRepository.listCommissionsFor(db, userId),
    referralRepository.listAdjustmentsFor(db, userId),
    referralRepository.listFlags(db, { referrerId: userId }),
    referralRepository.listPayoutsFor(db, userId),
    referralRepository.referredUsers(db, userId),
    balanceFor(db, userId, settings.payoutCurrency),
    referralRepository.nameFor(db, userId),
  ]);
  const people = await referralRepository.usersByIds(db, [...new Set([...commissions.map((c) => c.buyerId), ...flags.map((f) => f.referredUserId), ...referred.map((r) => r.id)])]);
  const email = new Map(people.map((p) => [p.id, p.email]));
  return {
    user: { id: user.id, email: user.email, name, code: user.referralCode, role: user.role.key },
    currency: settings.payoutCurrency,
    balance,
    commissions: commissions.map((c) => ({ id: c.id, buyerEmail: email.get(c.buyerId) ?? "unknown", course: c.courseTitle, sale: c.saleAmount, rateBps: c.rateBps, commission: c.commissionAmount, currency: c.currency, status: c.status, availableAt: c.availableAt, reversedReason: c.reversedReason, createdAt: c.createdAt })),
    adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, amount: a.amount, currency: a.currency, note: a.note, settled: !!a.settledPayoutId, createdAt: a.createdAt })),
    flags: flags.map((f) => ({ id: f.id, kind: f.kind, detail: f.detail, referredEmail: email.get(f.referredUserId) ?? "unknown", createdAt: f.createdAt, reviewed: !!f.reviewedAt })),
    payouts: payouts.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, reference: p.reference, requestedAt: p.requestedAt })),
    referred: referred.map((r) => ({ id: r.id, email: email.get(r.id) ?? "unknown", at: r.referredAt })),
  };
}

export async function reviewReferralFlag(db: PrismaClient, actor: Actor, flagId: string) {
  authorize(actor, "referral.manage");
  if (!(await referralRepository.findFlag(db, flagId))) throw new NotFoundError();
  await referralRepository.reviewFlag(db, flagId, actor.userId);
}
