import { z } from "zod";
import type { Actor } from "@/server/auth/actor";
import type { Db, PrismaClient } from "@/server/db/types";
import { authorize } from "@/server/policies/authorize";
import { settingRepository } from "@/server/repositories/setting.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";

/**
 * Platform settings with typed defaults (Section 14 defaults live here).
 * Reads are open to any actor; writes require settings.manage and are audited.
 */
export const SETTING_SCHEMAS = {
  reservationTtlDays: z.number().int().positive().default(7),
  hoursPerMonthDefault: z.number().int().positive().default(173),
  defaultClientCurrency: z.string().length(3).default("USD"),
  identityDisclosureLevel: z.enum(["DISPLAY_NAME", "FULL_NAME"]).default("DISPLAY_NAME"),
  allowFreeMailClients: z.boolean().default(false),
  autoAssignAccountManager: z.boolean().default(false),
  marketplaceAccess: z.enum(["GATED", "PUBLIC"]).default("GATED"),
  /** Section 10: weights for rule-based matching. Hard rules are not weighted. */
  matchWeights: z.object({ skills: z.number().default(30), industry: z.number().default(10), experienceLevel: z.number().default(10), certifications: z.number().default(15), timezone: z.number().default(15), budget: z.number().default(10), assessment: z.number().default(10) }).default({ skills: 30, industry: 10, experienceLevel: 10, certifications: 15, timezone: 15, budget: 10, assessment: 10 }),
  /** Section 14 Q18: days of inactivity after which a soft-deleted or inactive account is anonymised by the admin-run job. */
  retentionDays: z.number().int().positive().default(730),
  /** Agency marketplace (A1): application rules. Nothing about cooldowns is hardcoded elsewhere. */
  agencyApplications: z
    .object({
      reapplyCooldownDays: z.number().int().min(0).max(3650).default(30),
      maxDocuments: z.number().int().min(0).max(20).default(5),
      maxDocumentBytes: z.number().int().positive().default(20 * 1024 * 1024),
      reviewDueDays: z.number().int().min(1).max(60).default(3),
    })
    .default(() => ({ reapplyCooldownDays: 30, maxDocuments: 5, maxDocumentBytes: 20 * 1024 * 1024, reviewDueDays: 3 })),
  /** Identity phase 1: duplicate detection and rejoin behaviour (decision a). */
  identity: z
    .object({
      /** Joining another agency later (or the same one again) creates a fresh talent profile. */
      rejoinCreatesFreshProfile: z.boolean().default(true),
      duplicateCheckPhone: z.boolean().default(true),
      /** Email the existing address when a sign-up matches it. */
      notifyExistingOnDuplicate: z.boolean().default(true),
      /** Hours a sign-up continuation link stays valid after Admin approves a flagged sign-up. */
      continuationLinkHours: z.number().int().min(1).max(720).default(72),
    })
    .default(() => ({ rejoinCreatesFreshProfile: true, duplicateCheckPhone: true, notifyExistingOnDuplicate: true, continuationLinkHours: 72 })),
  /** Identity phase 1: unified terms behaviour (decision b). */
  terms: z
    .object({
      /** Staff accounts are not gated by the terms unless this is on. */
      gateStaff: z.boolean().default(false),
    })
    .default(() => ({ gateStaff: false })),
  /** v2 phase 2: Agent Seats and invitations. */
  agencySeats: z
    .object({
      /** Used by the exit flows (phase 3). */
      seatReleaseRule: z.enum(["IMMEDIATE", "AFTER_BILLING_PERIOD", "AFTER_ASSIGNMENT_ENDS"]).default("IMMEDIATE"),
      /** 0 = the agency link never expires (it can still be rotated). */
      inviteLinkTtlDays: z.number().int().min(0).max(3650).default(0),
      emailInviteTtlDays: z.number().int().min(1).max(365).default(14),
      /** A join whose email is never verified gives its seat back after this many days. */
      unverifiedJoinTtlDays: z.number().int().min(1).max(365).default(14),
    })
    .default(() => ({ seatReleaseRule: "IMMEDIATE" as const, inviteLinkTtlDays: 0, emailInviteTtlDays: 14, unverifiedJoinTtlDays: 14 })),
  /** v2 phase 3: exit flows. */
  agencyExit: z
    .object({
      /** Days an agency has to answer a leave request before Hirewise takes it over. */
      ownerResponseDays: z.number().int().min(1).max(60).default(5),
      /** Hirewise reviews every exit, not only those with an active client assignment. */
      adminReviewAlways: z.boolean().default(false),
      /** Days after an exit before the former profile is archived. */
      archiveAfterDays: z.number().int().min(0).max(3650).default(30),
    })
    .default(() => ({ ownerResponseDays: 5, adminReviewAlways: false, archiveAfterDays: 30 })),
  /** Section 8.8 thresholds. */
  profileViewBurstPerHour: z.number().int().positive().default(60),
  shortlistChurnPerDay: z.number().int().positive().default(12),
  /** Sign-up onboarding: the required welcome video and whether it locks the Academy (edited under Staff → Academy → Onboarding). */
  onboardingWelcomeVideo: z
    .object({
      enabled: z.boolean().default(false),
      title: z.string().trim().min(1).max(160).default("Welcome to Hirewise"),
      instructions: z.string().trim().max(4000).default(""),
      /** Direct URL to a video file (mp4/webm). Used when no file was uploaded. */
      videoUrl: z.string().trim().url().nullable().default(null),
      /** Uploaded file under onboarding/welcome/. Takes precedence over videoUrl. */
      storageKey: z.string().trim().nullable().default(null),
      fileName: z.string().trim().nullable().default(null),
      durationSec: z.number().positive().nullable().default(null),
      requiredPercent: z.number().int().min(1).max(100).default(90),
      lockCourses: z.boolean().default(true),
      appliesTo: z.enum(["NEW", "ALL"]).default("NEW"),
      /** Users created at or after this instant are "new". Set when the requirement is first enabled. */
      effectiveFrom: z.string().datetime().nullable().default(null),
      /** Changes whenever the video source changes; progress is tracked per key. */
      videoKey: z.string().default("v1"),
    })
    .default(() => ({ enabled: false, title: "Welcome to Hirewise", instructions: "", videoUrl: null, storageKey: null, fileName: null, durationSec: null, requiredPercent: 90, lockCourses: true, appliesTo: "NEW" as const, effectiveFrom: null, videoKey: "v1" })),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export async function getSetting<K extends SettingKey>(db: Db | PrismaClient, key: K): Promise<SettingValue<K>> {
  const row = await settingRepository.get(db, key);
  const schema = SETTING_SCHEMAS[key];
  return schema.parse(row ? row.value : undefined) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(db: PrismaClient, actor: Actor, key: K, value: SettingValue<K>, reason?: string): Promise<void> {
  authorize(actor, "settings.manage");
  const parsed = SETTING_SCHEMAS[key].parse(value);
  await db.$transaction(async (tx) => {
    const previous = await settingRepository.get(tx, key);
    await settingRepository.upsert(tx, key, parsed as never, actor.userId === "system" ? null : actor.userId);
    await audit(tx, { actor, action: "SETTING_CHANGED", entityType: "Setting", entityId: key, previousValue: previous?.value, newValue: parsed, reason });
    await publishEvent(tx, "SETTING_CHANGED", { key, changedBy: actor.userId === "system" ? null : actor.userId });
  });
}
