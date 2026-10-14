import type { PrismaClient, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { identityRepository, type ContactInput } from "@/server/repositories/identity.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { tokenRepository } from "@/server/repositories/token.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { assertFlagTransition, type DuplicateFlagDecision } from "@/server/state/duplicate-flag";
import { toIdentityStaffView, toIdentityListView, toDuplicateFlagView } from "@/server/views/identity.views";
import { randomToken, sha256 } from "@/server/auth/crypto";
import { sendEmailNow } from "@/server/jobs/mailer";
import { templates } from "@/server/notifications/templates";
import { getEnv } from "@/server/env";

/**
 * Platform Identity (Identity phase 1): the permanent, Hirewise-only record behind every talent-type account,
 * duplicate detection at sign-up, and the Admin queue that decides what happens to a flagged attempt.
 * Clients and agencies never receive anything from this module (FORBIDDEN_FOR_CLIENT / FORBIDDEN_FOR_AGENCY).
 */

export type MatchReason = "EMAIL" | "PHONE" | "IDENTITY" | "ACTIVE_MEMBERSHIP" | "INDEPENDENT_PROFILE";
export type DuplicateCheck = { matched: boolean; reasons: MatchReason[]; identityId: string | null; userId: string | null; matchedEmail: string | null };
export type SignupKind = "SIGNUP" | "AGENCY_APPLICATION" | "INVITE_JOIN" | "INDEPENDENT_REAPPLY";

export const DUPLICATE_MESSAGE = "Existing Hirewise Connect membership detected. If this is you, sign in instead. Hirewise has been notified and will review this sign-up.";

/** Thrown instead of creating an account. Maps to a field error on the email, with the generic message (decision g). */
export class DuplicateDetectedError extends Error {
  readonly name = "DuplicateDetectedError";
  readonly field = "email";
  readonly status = 409;
  constructor(public readonly flagId: string | null) {
    super(DUPLICATE_MESSAGE);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits and a leading plus only (an international 00 prefix becomes +), mirroring the backfill in the data migration. Null when too short to be a number. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const kept = phone.replace(/[^0-9+]/g, "").replace(/^00/, "+");
  const normalized = (kept.startsWith("+") ? "+" : "") + kept.replace(/\+/g, "");
  return normalized.replace(/\D/g, "").length >= 6 ? normalized : null;
}

function appUrl(): string {
  try {
    return getEnv().APP_URL.replace(/\/$/, "");
  } catch {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/** Who an attempted sign-up matches: the login email, any identity contact (email or phone), and what that identity is doing. */
export async function detectDuplicates(db: Db, input: { email: string; phone?: string | null }): Promise<DuplicateCheck> {
  const email = normalizeEmail(input.email);
  const settings = await getSetting(db, "identity");
  const phone = settings.duplicateCheckPhone ? normalizePhone(input.phone) : null;
  const reasons = new Set<MatchReason>();
  let identityId: string | null = null;
  let userId: string | null = null;
  let matchedEmail: string | null = null;

  const user = await userRepository.findByEmail(db, email);
  if (user) {
    reasons.add("EMAIL");
    userId = user.id;
    matchedEmail = user.email;
  }
  const contacts = await identityRepository.findContactMatches(db, { emails: [email], phones: phone ? [phone] : [] });
  for (const c of contacts) {
    if (c.identity.status === "MERGED") continue;
    reasons.add(c.kind === "EMAIL" ? "EMAIL" : "PHONE");
    reasons.add("IDENTITY");
    identityId ??= c.identity.id;
    userId ??= c.identity.userId;
    matchedEmail ??= c.identity.user.email;
    const profile = c.identity.profiles[0];
    if (profile?.agencyMemberships.length) reasons.add("ACTIVE_MEMBERSHIP");
    if (profile?.talentType === "INDEPENDENT_FREELANCER") reasons.add("INDEPENDENT_PROFILE");
  }
  if (userId && !identityId) {
    const ident = await identityRepository.findByUserId(db, userId);
    if (ident) identityId = ident.id;
  }
  return { matched: reasons.size > 0, reasons: [...reasons], identityId, userId, matchedEmail };
}

const FLAG_DEDUPE_WINDOW_MS = 24 * 60 * 60_000;

/** Records the attempt for Admin review (once per email per day) and tells the handlers whether to warn the existing address. */
export async function raiseDuplicateFlag(db: PrismaClient, p: { kind: SignupKind; email: string; phone?: string | null; fullName: string; data?: Record<string, unknown>; check: DuplicateCheck; meta: RequestMeta }): Promise<string> {
  const email = normalizeEmail(p.email);
  const recent = await identityRepository.recentOpenFlag(db, email, new Date(Date.now() - FLAG_DEDUPE_WINDOW_MS));
  if (recent) return recent.id;
  const settings = await getSetting(db, "identity");
  const safeData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.data ?? {})) if (!/password/i.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) safeData[k] = v;
  return db.$transaction(async (tx) => {
    const flag = await identityRepository.createFlag(tx, {
      kind: p.kind,
      attemptedEmail: email,
      attemptedPhone: normalizePhone(p.phone),
      attemptedName: p.fullName,
      attemptedData: safeData,
      matchedIdentityId: p.check.identityId,
      matchedUserId: p.check.userId,
      matchReasons: p.check.reasons,
      ipAddress: p.meta.ipAddress ?? null,
    });
    await audit(tx, { actor: systemActor(), action: "DUPLICATE_FLAG_RAISED", entityType: "DuplicateFlag", entityId: flag.id, newValue: { kind: p.kind, attemptedEmail: email, matchReasons: p.check.reasons, matchedIdentityId: p.check.identityId }, ipAddress: p.meta.ipAddress ?? undefined });
    await publishEvent(tx, "DUPLICATE_FLAG_RAISED", { flagId: flag.id, kind: p.kind, attemptedEmail: email, attemptedName: p.fullName, matchReasons: p.check.reasons, matchedUserId: p.check.userId, matchedEmail: settings.notifyExistingOnDuplicate ? p.check.matchedEmail : null, notifyExisting: settings.notifyExistingOnDuplicate && !!p.check.matchedEmail });
    return flag.id;
  });
}

/**
 * The sign-up guard every talent-type registration runs before creating anything. A valid continuation token
 * (issued when Admin approved an earlier flag for this email) skips detection and is consumed; otherwise a match
 * raises a flag and throws, so no account is created.
 */
export async function guardSignup(db: PrismaClient, p: { kind: SignupKind; email: string; phone?: string | null; fullName: string; data?: Record<string, unknown>; continuationToken?: string | null; meta: RequestMeta }): Promise<{ continuedFromToken: boolean }> {
  if (p.continuationToken) {
    const t = await tokenRepository.findUsable(db, "SIGNUP_CONTINUATION", sha256(p.continuationToken));
    if (!t || normalizeEmail(t.email) !== normalizeEmail(p.email)) throw Object.assign(new Error("This sign-up link is invalid, expired, or for a different email address."), { name: "RegistrationError", field: "email" });
    const { count } = await tokenRepository.consume(db, t.id);
    if (count === 0) throw Object.assign(new Error("This sign-up link was already used."), { name: "RegistrationError", field: "email" });
    return { continuedFromToken: true };
  }
  const check = await detectDuplicates(db, { email: p.email, phone: p.phone });
  if (!check.matched) return { continuedFromToken: false };
  const flagId = await raiseDuplicateFlag(db, { kind: p.kind, email: p.email, phone: p.phone, fullName: p.fullName, data: p.data, check, meta: p.meta });
  throw new DuplicateDetectedError(flagId);
}

/** What a continuation link is for, so the page can show the right form with the email fixed. */
export async function describeContinuation(db: PrismaClient, rawToken: string): Promise<{ email: string; kind: SignupKind } | null> {
  const t = await tokenRepository.findUsable(db, "SIGNUP_CONTINUATION", sha256(rawToken));
  if (!t) return null;
  const flag = await identityRepository.approvedFlagForEmail(db, t.email);
  const full = flag ? await identityRepository.findFlag(db, flag.id) : null;
  return { email: t.email, kind: (full?.kind ?? "SIGNUP") as SignupKind };
}

// ---------------------------------------------------------------------------
// Identity records
// ---------------------------------------------------------------------------

function contactsFor(p: { email: string; phone?: string | null; verifiedAt?: Date | null; source: ContactInput["source"] }): ContactInput[] {
  const out: ContactInput[] = [{ kind: "EMAIL", valueNormalized: normalizeEmail(p.email), valueDisplay: p.email.trim(), source: p.source, verifiedAt: p.verifiedAt ?? null }];
  const phone = normalizePhone(p.phone);
  if (phone) out.push({ kind: "PHONE", valueNormalized: phone, valueDisplay: p.phone!.trim(), source: p.source });
  return out;
}

/** Creates the identity for a new talent-type user inside the registration transaction. Idempotent per user. */
export async function ensureIdentity(tx: Db, actor: Actor, p: { userId: string; email: string; phone?: string | null; verifiedAt?: Date | null; source?: ContactInput["source"] }): Promise<string> {
  const existing = await identityRepository.findByUserId(tx, p.userId);
  if (existing) return existing.id;
  const identity = await identityRepository.createIdentity(tx, { userId: p.userId, primaryEmail: normalizeEmail(p.email), verifiedAt: p.verifiedAt ?? null, contacts: contactsFor({ ...p, source: p.source ?? "SIGNUP" }) });
  await audit(tx, { actor, action: "IDENTITY_CREATED", entityType: "PlatformIdentity", entityId: identity.id, newValue: { userId: p.userId, email: normalizeEmail(p.email), phone: normalizePhone(p.phone) } });
  return identity.id;
}

/** Keeps identity contacts in step with profile edits (private contact phone or email). */
export async function syncIdentityContact(tx: Db, actor: Actor, userId: string, c: { kind: "EMAIL" | "PHONE"; value: string | null | undefined; source: ContactInput["source"] }): Promise<void> {
  const identity = await identityRepository.findByUserId(tx, userId);
  if (!identity || !c.value) return;
  const normalized = c.kind === "EMAIL" ? normalizeEmail(c.value) : normalizePhone(c.value);
  if (!normalized) return;
  await identityRepository.addContact(tx, identity.id, { kind: c.kind, valueNormalized: normalized, valueDisplay: c.value.trim(), source: c.source });
  await audit(tx, { actor, action: "IDENTITY_CONTACT_ADDED", entityType: "PlatformIdentity", entityId: identity.id, newValue: { kind: c.kind, value: normalized, source: c.source } });
}

// ---------------------------------------------------------------------------
// Staff: identities and the duplicate queue
// ---------------------------------------------------------------------------

export async function listIdentities(db: PrismaClient, actor: Actor, q?: string) {
  authorize(actor, "identity.read");
  return (await identityRepository.list(db, q?.trim() || undefined)).map(toIdentityListView);
}

export async function identityForStaff(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "identity.read");
  const r = await identityRepository.findDetail(db, id);
  if (!r) throw new NotFoundError();
  return toIdentityStaffView(r);
}

export async function listDuplicateFlags(db: PrismaClient, actor: Actor, status: "OPEN" | "APPROVED_NEW_PROFILE" | "LINKED" | "REJECTED" | "ALL" = "OPEN") {
  authorize(actor, "identity.review");
  const [rows, counts] = await Promise.all([identityRepository.listFlags(db, status), identityRepository.flagCounts(db)]);
  return { rows: rows.map(toDuplicateFlagView), counts };
}

export async function getDuplicateFlag(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "identity.review");
  const f = await identityRepository.findFlag(db, id);
  if (!f) throw new NotFoundError();
  return toDuplicateFlagView(f);
}

/**
 * Decide a flag. APPROVED_NEW_PROFILE emails the person a one-time continuation link that lets the same sign-up
 * through without detection; LINKED tells the existing address to sign in; REJECTED closes the case.
 */
export async function decideDuplicateFlag(db: PrismaClient, actor: Actor, id: string, decision: DuplicateFlagDecision, note: string | null, meta: RequestMeta) {
  authorize(actor, "identity.review");
  const flag = await identityRepository.findFlag(db, id);
  if (!flag) throw new NotFoundError();
  assertFlagTransition(flag.status, decision);
  const settings = await getSetting(db, "identity");
  let raw: string | null = null;
  let tokenId: string | null = null;
  if (decision === "APPROVED_NEW_PROFILE") {
    await tokenRepository.invalidateAll(db, "SIGNUP_CONTINUATION", flag.attemptedEmail);
    raw = randomToken(32);
    const t = await tokenRepository.create(db, { kind: "SIGNUP_CONTINUATION", tokenHash: sha256(raw), userId: null, email: flag.attemptedEmail, expiresAt: new Date(Date.now() + settings.continuationLinkHours * 60 * 60_000) });
    tokenId = t.id;
  }
  await db.$transaction(async (tx) => {
    await identityRepository.decideFlag(tx, id, { status: decision, reviewedById: actor.userId, decisionNote: note, continuationTokenId: tokenId });
    await audit(tx, { actor, action: "DUPLICATE_FLAG_DECIDED", entityType: "DuplicateFlag", entityId: id, previousValue: { status: flag.status }, newValue: { status: decision, continuationIssued: !!tokenId }, reason: note ?? undefined, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "DUPLICATE_FLAG_DECIDED", { flagId: id, decision, attemptedEmail: flag.attemptedEmail, attemptedName: flag.attemptedName, continuationUrl: null, matchedEmail: flag.matchedIdentity?.user.email ?? null });
  });
  if (raw) {
    const url = `${appUrl()}/register/continue/${raw}`;
    await sendEmailNow(db, { kind: "signup_continuation", to: flag.attemptedEmail, ...templates.signupContinuation(url, flag.attemptedName, settings.continuationLinkHours) });
  }
  return { id, status: decision };
}
