import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import type { RoleKey } from "@/server/policies/permissions";
import { authorize, ForbiddenError } from "@/server/policies/authorize";
import { termsRepository, type TermsType, type TermsVersionRecord } from "@/server/repositories/terms.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { toCsv } from "@/server/services/report.service";
import { audiencesForRole, checkboxLabel, renderTermsBody, PLACEHOLDER_MARK } from "@/server/terms/placeholder-terms";
import { toTermsDocumentView, toTermsVersionAdminView, type TermsDocumentView } from "@/server/views/terms.views";

/**
 * The unified "Hirewise Connect Terms & Platform Agreement" and the Privacy Policy (Identity phase 1).
 * One checkbox at sign-up and one on re-acceptance; every acceptance stores user, role, agency, version,
 * checksum, time, context, and (INV-I2) IP and user agent.
 */

export const STAFF_ROLES: ReadonlySet<string> = new Set(["SUPER_ADMIN", "ADMIN", "SALES", "RECRUITER", "COACH"]);
export const DEFAULT_TERMS_ROLES: RoleKey[] = ["AGENT", "CLIENT", "APPLICANT", "AGENCY_OWNER", "AGENCY_MANAGER"];

export type TermsStatus = {
  /** True when this actor must accept before using the app. */
  required: boolean;
  missing: TermsType[];
  reason: "NEW" | "MATERIAL_CHANGE" | null;
  termsVersion: number | null;
  acceptedTermsVersion: number | null;
};

export type TermsBundle = {
  terms: TermsDocumentView | null;
  privacy: TermsDocumentView | null;
  mode: "COMBINED" | "SEPARATE";
  checkboxLabel: string;
};

function checksum(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

/** Error with the field name so forms highlight the checkbox. */
export function requireTermsAccepted(accepted: boolean): void {
  if (!accepted) throw Object.assign(new Error("Please accept the Hirewise Connect Terms & Platform Agreement to continue."), { name: "RegistrationError", field: "termsAccepted" });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function activeBundle(db: Db) {
  const [terms, privacy] = await Promise.all([termsRepository.activeByType(db, "PLATFORM_TERMS"), termsRepository.activeByType(db, "PRIVACY_POLICY")]);
  const mode = terms?.privacyPolicyMode ?? "COMBINED";
  return { terms, privacy, mode };
}

/** The current documents, with the sections relevant to a role marked. Public: carries no user data. */
export async function termsForRole(db: Db, role: RoleKey | null): Promise<TermsBundle> {
  const { terms, privacy, mode } = await activeBundle(db);
  const audiences = audiencesForRole(role ?? "AGENT");
  return { terms: terms ? toTermsDocumentView(terms, audiences) : null, privacy: privacy ? toTermsDocumentView(privacy, audiences) : null, mode, checkboxLabel: checkboxLabel(mode) };
}

/**
 * Which versions count as "current" for a document: the active one plus every older version back to the last that
 * required re-acceptance. A non-material version therefore does not re-gate anyone who accepted before it.
 */
function acceptableIds<T extends Pick<TermsVersionRecord, "id" | "version" | "isActive" | "requiresReacceptance">>(versions: T[]): { active: T | null; ids: string[] } {
  const active = versions.find((v) => v.isActive) ?? null;
  if (!active) return { active: null, ids: [] };
  const ids: string[] = [];
  for (const v of versions) {
    if (v.version > active.version) continue;
    ids.push(v.id);
    if (v.requiresReacceptance) break;
  }
  return { active, ids };
}

export async function termsStatusFor(db: Db, actor: Pick<Actor, "userId" | "role">): Promise<TermsStatus> {
  const termsVersions = await termsRepository.versionsByType(db, "PLATFORM_TERMS");
  const t = acceptableIds(termsVersions);
  const none: TermsStatus = { required: false, missing: [], reason: null, termsVersion: t.active?.version ?? null, acceptedTermsVersion: null };
  if (!t.active) return none;
  let applies = (t.active.requiredForRoles as string[]).includes(actor.role);
  if (!applies && STAFF_ROLES.has(actor.role)) applies = (await getSetting(db, "terms")).gateStaff;
  const privacyVersions = await termsRepository.versionsByType(db, "PRIVACY_POLICY");
  const p = acceptableIds(privacyVersions);
  const accepted = await termsRepository.acceptedAgreementIds(db, actor.userId, [...termsVersions.map((v) => v.id), ...privacyVersions.map((v) => v.id)]);
  const acceptedIds = new Set(accepted.map((a) => a.agreementId));
  const acceptedTermsVersion = termsVersions.filter((v) => acceptedIds.has(v.id)).map((v) => v.version).sort((a, b) => b - a)[0] ?? null;
  if (!applies) return { ...none, acceptedTermsVersion };
  const missing: TermsType[] = [];
  if (!t.ids.some((id) => acceptedIds.has(id))) missing.push("PLATFORM_TERMS");
  if (p.active && !p.ids.some((id) => acceptedIds.has(id))) missing.push("PRIVACY_POLICY");
  return { required: missing.length > 0, missing, reason: missing.length ? (acceptedTermsVersion === null ? "NEW" : "MATERIAL_CHANGE") : null, termsVersion: t.active.version, acceptedTermsVersion };
}

// ---------------------------------------------------------------------------
// Accepting
// ---------------------------------------------------------------------------

export type AcceptContext = "SIGNUP" | "AGENCY_APPLICATION" | "INDEPENDENT_REAPPLICATION" | "REACCEPTANCE" | "GENERAL";

/**
 * Records the single-checkbox acceptance for the current documents inside the caller's transaction. Used at
 * sign-up (before the actor exists), by the re-acceptance gate, and contextually by the agency application.
 */
export async function acceptTermsTx(tx: Db, p: { userId: string; role: RoleKey; agencyId?: string | null; context: AcceptContext; applicationId?: string | null; meta: RequestMeta; actor?: Actor }): Promise<{ termsVersion: number; privacyVersion: number | null; termsAgreementId: string; termsAcceptanceId: string }> {
  const { terms, privacy } = await activeBundle(tx);
  if (!terms) throw new Error("The Hirewise Connect Terms & Platform Agreement is not published yet. Ask Hirewise to publish it.");
  const actor: Actor = p.actor ?? { userId: p.userId, role: p.role, permissions: new Set() };
  const docs = [terms, ...(privacy ? [privacy] : [])];
  let termsAcceptanceId = "";
  for (const doc of docs) {
    const r = await termsRepository.recordAcceptance(tx, { agreementId: doc.id, userId: p.userId, role: p.role, agencyId: p.agencyId ?? null, bodyChecksum: doc.bodyChecksum, context: p.context, applicationId: p.applicationId ?? null, ipAddress: p.meta.ipAddress, userAgent: p.meta.userAgent });
    if (doc.type === "PLATFORM_TERMS") termsAcceptanceId = r.id;
    if (r.created) {
      await audit(tx, { actor, action: "TERMS_ACCEPTED", entityType: "Agreement", entityId: doc.id, newValue: { type: doc.type, version: doc.version, checksum: doc.bodyChecksum, context: p.context, role: p.role, agencyId: p.agencyId ?? null, applicationId: p.applicationId ?? null }, ipAddress: p.meta.ipAddress ?? undefined });
    }
  }
  return { termsVersion: terms.version, privacyVersion: privacy?.version ?? null, termsAgreementId: terms.id, termsAcceptanceId };
}

/** The re-acceptance gate: one checkbox for whatever is missing. */
export async function acceptCurrentTerms(db: PrismaClient, actor: Actor, meta: RequestMeta): Promise<TermsStatus> {
  const status = await termsStatusFor(db, actor);
  if (!status.required) return status;
  await db.$transaction(async (tx) => {
    await acceptTermsTx(tx, { userId: actor.userId, role: actor.role, agencyId: actor.agency?.id ?? null, context: status.acceptedTermsVersion === null ? "GENERAL" : "REACCEPTANCE", meta, actor });
  });
  return termsStatusFor(db, actor);
}

/** The actor's own acceptance rows for the two documents (account page). */
export function myTermsAcceptances(db: PrismaClient, actor: Actor) {
  return termsRepository.acceptancesForUser(db, actor.userId);
}

// ---------------------------------------------------------------------------
// Admin: versions
// ---------------------------------------------------------------------------

const sectionSchema = z.object({
  key: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(160),
  audiences: z.array(z.enum(["ALL", "AGENT", "AGENCY_OWNER", "CLIENT", "TRAINING"])).min(1),
  bodyMarkdown: z.string().trim().min(1).max(20000),
});

export const publishTermsSchema = z.object({
  type: z.enum(["PLATFORM_TERMS", "PRIVACY_POLICY"]),
  title: z.string().trim().min(3).max(160),
  sections: z.array(sectionSchema).min(1, "Add at least one section."),
  effectiveFrom: z.string().trim().min(1, "Set the effective date."),
  isMaterialChange: z.boolean().default(false),
  requiresReacceptance: z.boolean().default(true),
  privacyPolicyMode: z.enum(["COMBINED", "SEPARATE"]).default("COMBINED"),
  requiredForRoles: z.array(z.enum(["SUPER_ADMIN", "ADMIN", "SALES", "RECRUITER", "COACH", "AGENT", "CLIENT", "APPLICANT", "AGENCY_OWNER", "AGENCY_MANAGER"])).optional(),
  changeNote: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function listTermsVersions(db: PrismaClient, actor: Actor) {
  if (!actor.permissions.has("terms.manage") && !actor.permissions.has("terms.report")) throw new ForbiddenError("Requires terms.manage or terms.report");
  const [terms, privacy] = await Promise.all([termsRepository.versionsByType(db, "PLATFORM_TERMS"), termsRepository.versionsByType(db, "PRIVACY_POLICY")]);
  return { terms: terms.map(toTermsVersionAdminView), privacy: privacy.map(toTermsVersionAdminView) };
}

/**
 * Publish a new version. Previous versions become inactive. A material version with requiresReacceptance
 * re-gates everyone in the required roles on their next request; a non-material one does not.
 */
export async function publishTermsVersion(db: PrismaClient, actor: Actor, raw: z.input<typeof publishTermsSchema>) {
  authorize(actor, "terms.manage");
  const input = publishTermsSchema.parse(raw);
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Invalid effective date.");
  const sections = input.sections.map((s) => ({ ...s, bodyMarkdown: s.bodyMarkdown.replace(/\r\n/g, "\n") }));
  const body = renderTermsBody(input.title, sections);
  const placeholder = body.includes(PLACEHOLDER_MARK);
  return db.$transaction(async (tx) => {
    const versions = await termsRepository.versionsByType(tx, input.type);
    const latest = versions[0] ?? null;
    const version = (latest?.version ?? 0) + 1;
    await termsRepository.deactivateType(tx, input.type);
    const row = await termsRepository.createVersion(tx, {
      type: input.type,
      version,
      title: input.title,
      bodyMarkdown: body,
      bodyChecksum: checksum(body),
      effectiveFrom,
      requiredForRoles: (input.requiredForRoles ?? (latest?.requiredForRoles as RoleKey[] | undefined) ?? DEFAULT_TERMS_ROLES) as RoleKey[],
      sections,
      isMaterialChange: input.isMaterialChange,
      requiresReacceptance: input.requiresReacceptance,
      privacyPolicyMode: input.privacyPolicyMode,
      changeNote: input.changeNote || null,
      publishedById: actor.userId === "system" ? null : actor.userId,
      supersedesId: latest?.id ?? null,
    });
    await audit(tx, { actor, action: "TERMS_PUBLISHED", entityType: "Agreement", entityId: row.id, previousValue: latest ? { version: latest.version } : undefined, newValue: { type: input.type, version, checksum: row.bodyChecksum, isMaterialChange: input.isMaterialChange, requiresReacceptance: input.requiresReacceptance, placeholder }, reason: input.changeNote || undefined });
    await publishEvent(tx, "TERMS_VERSION_PUBLISHED", { agreementId: row.id, type: input.type, version, title: input.title, material: input.isMaterialChange, requiresReacceptance: input.requiresReacceptance, roles: row.requiredForRoles });
    return { id: row.id, version, placeholder };
  });
}

// ---------------------------------------------------------------------------
// Admin: acceptance report
// ---------------------------------------------------------------------------

export type AcceptanceRow = {
  userId: string;
  email: string;
  role: string;
  userStatus: string;
  agencyId: string | null;
  agencyName: string | null;
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
  termsContext: string | null;
  privacyVersion: number | null;
  privacyAcceptedAt: Date | null;
  status: "CURRENT" | "OUTDATED" | "NONE";
};

export async function acceptanceReport(db: PrismaClient, actor: Actor, filters: { role?: string | null; agencyId?: string | null; q?: string | null; status?: "CURRENT" | "OUTDATED" | "NONE" | null } = {}): Promise<{ rows: AcceptanceRow[]; summary: Record<AcceptanceRow["status"], number>; currentTermsVersion: number | null }> {
  authorize(actor, "terms.report");
  const termsVersions = await termsRepository.versionsByType(db, "PLATFORM_TERMS");
  const privacyVersions = await termsRepository.versionsByType(db, "PRIVACY_POLICY");
  const t = acceptableIds(termsVersions);
  const p = acceptableIds(privacyVersions);
  const roles = ((t.active?.requiredForRoles as RoleKey[] | undefined) ?? DEFAULT_TERMS_ROLES).filter((r) => !filters.role || r === filters.role);
  const users = roles.length ? await termsRepository.usersForAcceptanceReport(db, { roles, agencyId: filters.agencyId, q: filters.q }) : [];
  const rows: AcceptanceRow[] = users.map((u) => {
    const termsAcc = u.agreementAcceptances.filter((a) => a.agreement.type === "PLATFORM_TERMS");
    const privacyAcc = u.agreementAcceptances.filter((a) => a.agreement.type === "PRIVACY_POLICY");
    const latestTerms = termsAcc[0] ?? null;
    const latestPrivacy = privacyAcc[0] ?? null;
    const termsCurrent = termsAcc.some((a) => t.ids.includes(a.agreementId));
    const privacyCurrent = !p.active || privacyAcc.some((a) => p.ids.includes(a.agreementId));
    const status: AcceptanceRow["status"] = !latestTerms ? "NONE" : termsCurrent && privacyCurrent ? "CURRENT" : "OUTDATED";
    return {
      userId: u.id,
      email: u.email,
      role: u.role.key,
      userStatus: u.status,
      agencyId: u.agencyUsers[0]?.agencyId ?? null,
      agencyName: u.agencyUsers[0]?.agency.name ?? null,
      termsVersion: latestTerms?.agreement.version ?? null,
      termsAcceptedAt: latestTerms?.acceptedAt ?? null,
      termsContext: latestTerms?.context ?? null,
      privacyVersion: latestPrivacy?.agreement.version ?? null,
      privacyAcceptedAt: latestPrivacy?.acceptedAt ?? null,
      status,
    };
  }).filter((r) => !filters.status || r.status === filters.status);
  const summary = { CURRENT: 0, OUTDATED: 0, NONE: 0 } as Record<AcceptanceRow["status"], number>;
  for (const r of rows) summary[r.status] += 1;
  return { rows, summary, currentTermsVersion: t.active?.version ?? null };
}

export function acceptanceReportCsv(rows: AcceptanceRow[]): string {
  return toCsv(rows.map((r) => ({ email: r.email, role: r.role, userStatus: r.userStatus, agency: r.agencyName ?? "", termsVersion: r.termsVersion ?? "", termsAcceptedAt: r.termsAcceptedAt?.toISOString() ?? "", termsContext: r.termsContext ?? "", privacyVersion: r.privacyVersion ?? "", privacyAcceptedAt: r.privacyAcceptedAt?.toISOString() ?? "", status: r.status })));
}
