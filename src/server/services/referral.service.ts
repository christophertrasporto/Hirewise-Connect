import { createHmac, randomInt } from "node:crypto";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { referralRepository } from "@/server/repositories/referral.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getEnv } from "@/server/env";
import { getSetting } from "./setting.service";
import { digitsOnly, isReferralCodeShape, makeReferralCode, normalizeEmail, rateLabel } from "@/lib/referral";
import { toCommissionMemberView } from "@/server/views/referral.views";
import { balanceFor } from "./commission.service";

/**
 * Referral links, click logging, and attribution (referral affiliate program).
 * Attribution is written once, inside the sign-up transaction, and a database trigger keeps it that way.
 */

export const REFERRAL_COOKIE = "hw_ref";
const SESSION_LOOKBACK_DAYS = 90;

/** Keyed hash so a click log or a flag never holds a raw IP address, yet two sign-ups from one IP still compare equal. */
export function hashIp(ip: string | null | undefined): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(`ip:${ip.trim()}`).digest("hex");
}

/** Members who can refer: talent and agency owners. */
export function canRefer(actor: Actor): boolean {
  return actor.role === "AGENT" || actor.role === "AGENCY_OWNER";
}
export function assertCanRefer(actor: Actor): void {
  if (!canRefer(actor)) throw new ForbiddenError("Only talent and agency owners have a referral link.");
}

export function referralLink(code: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/join?ref=${encodeURIComponent(code)}`;
}

/** The member's one personal code, created on first use. Retries on the (very unlikely) collision. */
export async function ensureReferralCode(db: Db, userId: string): Promise<string> {
  const u = await referralRepository.userBasics(db, userId);
  if (!u) throw new Error("Unknown user.");
  if (u.referralCode) return u.referralCode;
  const name = await referralRepository.nameFor(db, userId);
  for (let i = 0; i < 8; i++) {
    const code = makeReferralCode(name, randomInt);
    if (await referralRepository.codeTaken(db, code)) continue;
    try {
      return (await referralRepository.setCode(db, userId, code)).referralCode!;
    } catch (e) {
      // Lost a race on the unique index; the next loop either finds the code another request set or tries a new one.
      const again = await referralRepository.userBasics(db, userId);
      if (again?.referralCode) return again.referralCode;
      if (i === 7) throw e;
    }
  }
  throw new Error("Could not create a referral code.");
}

/** A visit to /join?ref=CODE. Returns whether the code is live so the route knows whether to set the cookie. */
export async function recordClick(db: Db, code: string | null | undefined, p: { ip: string | null; userAgent: string | null; landingUrl: string }): Promise<{ ok: boolean }> {
  if (!isReferralCodeShape(code)) return { ok: false };
  const referrer = await referralRepository.userForCode(db, code);
  if (!referrer || referrer.status !== "ACTIVE" || referrer.deletedAt || !referralRepository.isEligibleRole(referrer.role.key)) return { ok: false };
  await referralRepository.createClick(db, { referrerId: referrer.id, landingUrl: p.landingUrl.slice(0, 500), ipHash: hashIp(p.ip), userAgent: p.userAgent?.slice(0, 300) ?? null });
  return { ok: true };
}

export async function cookieDays(db: Db | PrismaClient): Promise<number> {
  return (await getSetting(db, "referrals")).cookieDays;
}

/**
 * Called from the registration transaction for a user that was just created. Never fails the sign-up: an unknown or
 * unusable code is ignored. Self-referral is impossible by construction (a brand-new user cannot own a code) and by a
 * database check. Related-looking sign-ups are flagged, not blocked.
 */
export async function attachReferrer(tx: Db, p: { userId: string; email: string; phone?: string | null; code: string | null | undefined; meta: { ipAddress?: string | null; userAgent?: string | null } }): Promise<{ attached: boolean }> {
  if (!isReferralCodeShape(p.code)) return { attached: false };
  const referrer = await referralRepository.userForCode(tx, p.code);
  if (!referrer || referrer.id === p.userId || referrer.status !== "ACTIVE" || referrer.deletedAt) return { attached: false };
  const changed = await referralRepository.attach(tx, p.userId, referrer.id, new Date());
  if (changed === 0) return { attached: false };

  const kinds: Array<{ kind: "EMAIL_ALIAS" | "SAME_IP" | "SAME_PHONE"; detail: string }> = [];
  if (normalizeEmail(p.email) === normalizeEmail(referrer.email)) kinds.push({ kind: "EMAIL_ALIAS", detail: "Same mailbox after removing dots and plus tags." });
  const myIp = hashIp(p.meta.ipAddress);
  if (myIp) {
    const since = new Date(Date.now() - SESSION_LOOKBACK_DAYS * 86_400_000);
    const theirs = (await referralRepository.recentSessionIps(tx, referrer.id, since)).map((ip) => hashIp(ip));
    if (theirs.includes(myIp)) kinds.push({ kind: "SAME_IP", detail: "Signed up from an IP address the referrer used in the last 90 days." });
  }
  const phone = digitsOnly(p.phone);
  if (phone.length >= 7) {
    const theirPhones = (await referralRepository.phonesFor(tx, referrer.id)).map(digitsOnly).filter((d) => d.length >= 7);
    if (theirPhones.some((d) => d.slice(-9) === phone.slice(-9))) kinds.push({ kind: "SAME_PHONE", detail: "Same phone number as the referrer." });
  }

  await audit(tx, { actor: systemActor(), action: "REFERRAL_ATTACHED", entityType: "User", entityId: p.userId, newValue: { referrerUserId: referrer.id, flags: kinds.map((k) => k.kind) }, ipAddress: p.meta.ipAddress ?? undefined });
  await publishEvent(tx, "REFERRAL_SIGNUP", { referrerUserId: referrer.id, referredUserId: p.userId });
  if (kinds.length) {
    await referralRepository.createFlags(tx, kinds.map((k) => ({ referrerId: referrer.id, referredUserId: p.userId, kind: k.kind, detail: k.detail })));
    await audit(tx, { actor: systemActor(), action: "REFERRAL_FLAGGED", entityType: "User", entityId: p.userId, newValue: { referrerUserId: referrer.id, kinds: kinds.map((k) => k.kind) } });
    await publishEvent(tx, "REFERRAL_FLAGGED", { referrerUserId: referrer.id, referredUserId: p.userId, kinds: kinds.map((k) => k.kind) });
  }
  return { attached: true };
}

/** Refer and Earn: the link, the rate, and the totals. */
export async function referralOverview(db: PrismaClient, actor: Actor) {
  assertCanRefer(actor);
  const settings = await getSetting(db, "referrals");
  const code = await ensureReferralCode(db, actor.userId);
  const [clicks, signups, sales, balance] = await Promise.all([
    referralRepository.clickCount(db, actor.userId),
    referralRepository.signupCount(db, actor.userId),
    referralRepository.commissionCount(db, actor.userId),
    balanceFor(db, actor.userId, settings.payoutCurrency),
  ]);
  return {
    code,
    link: referralLink(code),
    rateBps: settings.commissionRateBps,
    rateLabel: rateLabel(settings.commissionRateBps),
    holdDays: settings.holdDays,
    minimumPayoutMinor: settings.minimumPayoutMinor,
    currency: settings.payoutCurrency,
    clicks,
    signups,
    sales,
    onHold: balance.onHold,
    payable: balance.payable,
    paid: balance.paid,
    canRequestPayout: balance.payable >= settings.minimumPayoutMinor && balance.payable > 0,
  };
}

/** The member's commission history. Buyers appear as first name and last initial only. */
export async function myCommissions(db: PrismaClient, actor: Actor) {
  assertCanRefer(actor);
  const rows = await referralRepository.listCommissionsFor(db, actor.userId);
  const names = await referralRepository.namesFor(db, [...new Set(rows.map((r) => r.buyerId))]);
  return rows.map((r) => toCommissionMemberView(r, names.get(r.buyerId) ?? null));
}
