import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { audit } from "@/server/audit/audit";
import { getEnv } from "@/server/env";
import { SETTING_SCHEMAS, getSetting, setSetting, type SettingKey } from "./setting.service";
import { createHash } from "node:crypto";

/**
 * Launch preparation: agreement versioning (Q11 is a launch blocker until counsel supplies text),
 * a readiness report, and settings administration (Q18 retention periods, thresholds, weights).
 * Nothing here invents legal text: bodies come from the admin form and are flagged while they
 * still contain LEGAL_PLACEHOLDER.
 */

export const AGREEMENT_TYPES = ["CLIENT_TOS", "CLIENT_PRIVACY", "CLIENT_HIRING_TERMS", "CLIENT_NON_CIRCUMVENTION", "CLIENT_COMMUNICATION", "AGENT_PLATFORM_TERMS", "AGENT_PRIVACY", "AGENT_REPRESENTATION", "AGENT_NON_CIRCUMVENTION", "AGENT_CLIENT_COMMUNICATION", "AGENT_CONFIDENTIALITY", "PLACEMENT_SERVICE_AGREEMENT"] as const;
export type AgreementTypeKey = (typeof AGREEMENT_TYPES)[number];

export const agreementVersionSchema = z.object({
  type: z.enum(AGREEMENT_TYPES),
  title: z.string().trim().min(3).max(160),
  bodyMarkdown: z.string().trim().min(50, "The body is too short to be a real agreement."),
  effectiveFrom: z.string().trim().min(1, "Set the effective date."),
  changeNote: z.string().trim().max(500).optional().or(z.literal("")),
});

export const PLACEHOLDER_MARK = "LEGAL_PLACEHOLDER";

function checksum(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

/** All agreement types with their active version, placeholder state, and acceptance counts. */
export async function listAgreementsForAdmin(db: PrismaClient, actor: Actor) {
  authorize(actor, "agreement.manage");
  const rows = await db.agreement.findMany({ include: { _count: { select: { acceptances: true } } }, orderBy: [{ type: "asc" }, { version: "desc" }] });
  return AGREEMENT_TYPES.map((type) => {
    const versions = rows.filter((r) => r.type === type);
    const active = versions.find((v) => v.isActive) ?? null;
    return {
      type,
      requiredForRole: active?.requiredForRole ?? versions[0]?.requiredForRole ?? null,
      active: active ? { id: active.id, version: active.version, title: active.title, effectiveFrom: active.effectiveFrom, bodyMarkdown: active.bodyMarkdown, placeholder: active.bodyMarkdown.includes(PLACEHOLDER_MARK), acceptances: active._count.acceptances, checksum: active.bodyChecksum } : null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, title: v.title, isActive: v.isActive, effectiveFrom: v.effectiveFrom, acceptances: v._count.acceptances, placeholder: v.bodyMarkdown.includes(PLACEHOLDER_MARK) })),
    };
  });
}

/**
 * Publish a new version: previous versions of the type become inactive, so every user in the
 * required role is re-gated on next request (agreementsFor reads active versions only).
 * Existing acceptances stay attached to their version (INV-I2).
 */
export async function publishAgreementVersion(db: PrismaClient, actor: Actor, raw: z.infer<typeof agreementVersionSchema>) {
  authorize(actor, "agreement.manage");
  const input = agreementVersionSchema.parse(raw);
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Invalid effective date.");
  const body = input.bodyMarkdown.replace(/\r\n/g, "\n");
  return db.$transaction(async (tx) => {
    const latest = await tx.agreement.findFirst({ where: { type: input.type }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    const requiredForRole = input.type.startsWith("CLIENT_") ? ("CLIENT" as const) : input.type.startsWith("AGENT_") ? ("AGENT" as const) : null;
    await tx.agreement.updateMany({ where: { type: input.type, isActive: true }, data: { isActive: false } });
    const row = await tx.agreement.create({ data: { type: input.type, version, title: input.title, bodyMarkdown: body, bodyChecksum: checksum(body), effectiveFrom, isActive: true, requiredForRole: requiredForRole ?? undefined } });
    await audit(tx, { actor, action: "AGREEMENT_VERSION_PUBLISHED", entityType: "Agreement", entityId: row.id, previousValue: latest ? { version: latest.version } : null, newValue: { type: input.type, version, checksum: row.bodyChecksum, placeholder: body.includes(PLACEHOLDER_MARK) }, reason: input.changeNote || undefined });
    return { id: row.id, version };
  });
}

// ---------------------------------------------------------------------------
// Readiness report
// ---------------------------------------------------------------------------

export type Check = { key: string; label: string; status: "pass" | "warn" | "fail"; detail: string; href?: string };

export async function launchReadiness(db: PrismaClient, actor: Actor): Promise<{ checks: Check[]; summary: { pass: number; warn: number; fail: number } }> {
  authorize(actor, "settings.manage");
  const env = getEnv();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // Legal (Q11)
  const active = await db.agreement.findMany({ where: { isActive: true }, select: { type: true, bodyMarkdown: true, version: true } });
  const placeholders = active.filter((a) => a.bodyMarkdown.includes(PLACEHOLDER_MARK)).map((a) => a.type);
  const missing = AGREEMENT_TYPES.filter((t) => !active.some((a) => a.type === t));
  add({ key: "agreements", label: "Agreement text approved by counsel", status: placeholders.length || missing.length ? "fail" : "pass", detail: placeholders.length ? `${placeholders.length} active agreement(s) still contain ${PLACEHOLDER_MARK}: ${placeholders.join(", ")}` : missing.length ? `No active version for: ${missing.join(", ")}` : `All ${active.length} agreements have counsel text.`, href: "/staff/agreements" });

  // Environment
  const secret = process.env.AUTH_SECRET ?? "";
  add({ key: "authSecret", label: "AUTH_SECRET strength", status: secret.length >= 32 ? "pass" : secret.length >= 16 ? "warn" : "fail", detail: secret.length >= 32 ? "32+ characters." : `${secret.length} characters; generate with openssl rand -base64 32.` });
  add({ key: "appUrl", label: "APP_URL uses HTTPS", status: env.APP_URL.startsWith("https://") ? "pass" : "warn", detail: env.APP_URL });
  add({ key: "storage", label: "Object storage", status: env.STORAGE_DRIVER === "s3" ? "pass" : "warn", detail: env.STORAGE_DRIVER === "s3" ? `S3-compatible bucket ${env.S3_BUCKET}.` : "Local disk driver; use R2 or S3 in production." });
  add({ key: "email", label: "Email delivery", status: env.EMAIL_DRIVER === "smtp" ? "pass" : "warn", detail: env.EMAIL_DRIVER === "smtp" ? `SMTP via ${env.SMTP_HOST}.` : "Console driver logs emails instead of sending." });
  add({ key: "payments", label: "Payment provider", status: env.PAYMENT_PROVIDER === "stripe" ? "pass" : env.PAYMENT_PROVIDER === "manual" ? "warn" : "fail", detail: env.PAYMENT_PROVIDER === "stripe" ? "Stripe configured; register the webhook at /api/webhooks/stripe." : env.PAYMENT_PROVIDER === "manual" ? "Manual recording only; online payment disabled." : "Fake provider must not be used in production." });
  add({ key: "meetings", label: "Meeting links", status: env.MEETING_PROVIDER === "zoom" ? "pass" : env.MEETING_PROVIDER === "none" ? "warn" : "fail", detail: env.MEETING_PROVIDER === "zoom" ? "Zoom Server-to-Server app configured." : env.MEETING_PROVIDER === "none" ? "Sales pastes links (Q10 default)." : "Fake meeting provider produces non-working links." });
  add({ key: "sms", label: "SMS channel", status: env.SMS_DRIVER === "twilio" ? "pass" : "warn", detail: env.SMS_DRIVER === "twilio" ? "Twilio configured." : "Console driver; SMS reminders are logged only." });
  add({ key: "devLinks", label: "DEV_EXPOSE_LINKS off", status: process.env.DEV_EXPOSE_LINKS === "true" ? (env.NODE_ENV === "production" ? "fail" : "warn") : "pass", detail: process.env.DEV_EXPOSE_LINKS === "true" ? "Emailed links are shown in the UI." : "Links are only emailed." });

  // Accounts
  const demo = await db.user.count({ where: { email: { endsWith: ".example" }, deletedAt: null } });
  add({ key: "demoAccounts", label: "Demo accounts removed", status: demo === 0 ? "pass" : "warn", detail: demo === 0 ? "No .example accounts." : `${demo} seeded .example account(s) still exist (password Hirewise!2026).`, href: "/staff/users" });
  const adminsNoMfa = await db.user.count({ where: { status: "ACTIVE", deletedAt: null, mfaEnabled: false, role: { key: { in: ["SUPER_ADMIN", "ADMIN"] } } } });
  add({ key: "mfa", label: "MFA enrolled for Admin and Super Admin", status: adminsNoMfa === 0 ? "pass" : "warn", detail: adminsNoMfa === 0 ? "All admin accounts have MFA." : `${adminsNoMfa} admin account(s) have not enrolled yet (forced at next login).` });
  const superAdmins = await db.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { key: "SUPER_ADMIN" } } });
  add({ key: "superAdmin", label: "At least one Super Admin", status: superAdmins >= 1 ? "pass" : "fail", detail: `${superAdmins} active Super Admin account(s).` });

  // Settings (Q18 and commercial defaults)
  const retention = await getSetting(db, "retentionDays");
  add({ key: "retention", label: "Retention period confirmed (Q18)", status: retention === 730 ? "warn" : "pass", detail: retention === 730 ? "Still the default of 730 days; confirm with counsel for PH Data Privacy Act and GDPR." : `${retention} days.`, href: "/staff/settings" });
  const policy = await db.depositPolicy.findFirst({ where: { isDefault: true, isActive: true } });
  add({ key: "depositPolicy", label: "Default deposit policy", status: policy ? "pass" : "fail", detail: policy ? `${policy.name}.` : "No active default policy; approvals will fail.", href: "/staff/commercial/policies" });
  const labels = await db.assessmentResultLabel.count({ where: { isActive: true } });
  const templates = await db.certificationTemplate.count({ where: { isActive: true } });
  add({ key: "academy", label: "Academy labels and certification templates", status: labels > 0 && templates > 0 ? "pass" : "warn", detail: `${labels} result label(s), ${templates} template(s).`, href: "/staff/academy/settings" });

  // Operations
  const stale = await db.outboxEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } } });
  const failedJobs = await db.job.count({ where: { status: "FAILED" } }).catch(() => 0);
  add({ key: "worker", label: "Worker draining the outbox", status: stale === 0 ? "pass" : "fail", detail: stale === 0 ? "No events older than 10 minutes unprocessed." : `${stale} event(s) unprocessed for over 10 minutes; is npm run worker running?` });
  add({ key: "jobs", label: "Failed jobs", status: failedJobs === 0 ? "pass" : "warn", detail: `${failedJobs} job(s) in FAILED state.` });

  const summary = { pass: checks.filter((c) => c.status === "pass").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
  return { checks, summary };
}

// ---------------------------------------------------------------------------
// Settings administration
// ---------------------------------------------------------------------------

export const SETTING_META: Record<SettingKey, { label: string; help: string; kind: "number" | "boolean" | "text" | "json" | "enum"; options?: string[] }> = {
  reservationTtlDays: { label: "Reservation hold (days)", help: "How long a candidate stays held for one client (Section 5.8).", kind: "number" },
  hoursPerMonthDefault: { label: "Hours per month", help: "Converts hourly rates to a month for deposits and reports (Q6).", kind: "number" },
  defaultClientCurrency: { label: "Default client currency", help: "ISO code used for new billing rates (Q5).", kind: "text" },
  identityDisclosureLevel: { label: "Agent identity shown to clients", help: "DISPLAY_NAME until an interview is scheduled (Q3).", kind: "enum", options: ["DISPLAY_NAME", "FULL_NAME"] },
  allowFreeMailClients: { label: "Allow free-mail client sign-ups", help: "Gmail and similar domains at client registration.", kind: "boolean" },
  autoAssignAccountManager: { label: "Auto-assign account managers", help: "Round-robin instead of manual (Q14).", kind: "boolean" },
  marketplaceAccess: { label: "Marketplace access", help: "GATED: only active, agreement-accepted clients (Q2).", kind: "enum", options: ["GATED", "PUBLIC"] },
  matchWeights: { label: "Match weights", help: "Points per soft rule for requirement matching (Section 10).", kind: "json" },
  retentionDays: { label: "Retention period (days)", help: "Inactive accounts are anonymised by the retention job after this many days (Q18).", kind: "number" },
  profileViewBurstPerHour: { label: "Profile-view burst threshold", help: "Views per hour by one client before a scraping flag is raised (Section 8.8).", kind: "number" },
  shortlistChurnPerDay: { label: "Shortlist churn threshold", help: "Adds plus removals per day before a churn flag is raised.", kind: "number" },
};

export async function listSettings(db: PrismaClient, actor: Actor) {
  authorize(actor, "settings.manage");
  const keys = Object.keys(SETTING_SCHEMAS) as SettingKey[];
  const values = await Promise.all(keys.map((k) => getSetting(db, k)));
  return keys.map((key, i) => ({ key, value: values[i] as unknown, meta: SETTING_META[key] }));
}

export async function updateSetting(db: PrismaClient, actor: Actor, key: string, raw: string, reason?: string) {
  authorize(actor, "settings.manage");
  if (!(key in SETTING_SCHEMAS)) throw new Error("Unknown setting.");
  const k = key as SettingKey;
  const meta = SETTING_META[k];
  let value: unknown;
  if (meta.kind === "number") value = Number(raw);
  else if (meta.kind === "boolean") value = raw === "true" || raw === "on";
  else if (meta.kind === "json") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Enter valid JSON.");
    }
  } else value = raw.trim();
  await setSetting(db, actor, k, SETTING_SCHEMAS[k].parse(value) as never, reason);
}
