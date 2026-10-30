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
  /** v2 phase 4: independent reapplication (decision 4). */
  independentAccess: z
    .object({
      enabled: z.boolean().default(true),
      /** Minor units; 0 = no fee, the fresh profile is created at once. */
      feeMinor: z.number().int().min(0).max(100_000_000).default(0),
      currency: z.string().length(3).default("USD"),
    })
    .default(() => ({ enabled: true, feeMinor: 0, currency: "USD" })),
  /** v2 phase 5: client-safe documents. Generated PDFs (profile, certificate) are approved for clients without a reviewer when on. */
  clientProtection: z.object({ autoApproveGenerated: z.boolean().default(true) }).default(() => ({ autoApproveGenerated: true })),
  /** v2 phase 5: when the system grants disclosures (decision 6). MANUAL leaves it to staff. */
  disclosure: z
    .object({
      agentIdentityAt: z.enum(["INTERVIEW_SCHEDULED", "MANUAL"]).default("INTERVIEW_SCHEDULED"),
      clientIdentityForDirectTalent: z.enum(["INTERVIEW_SCHEDULED", "MANUAL"]).default("INTERVIEW_SCHEDULED"),
      clientIdentityForAgencyAgents: z.enum(["INTERVIEW_SCHEDULED", "MANUAL"]).default("MANUAL"),
    })
    .default(() => ({ agentIdentityAt: "INTERVIEW_SCHEDULED" as const, clientIdentityForDirectTalent: "INTERVIEW_SCHEDULED" as const, clientIdentityForAgencyAgents: "MANUAL" as const })),
  /** v2 phase 6a: messaging. MASK delivers the message with contact details removed; BLOCK holds it for review. */
  messaging: z.object({ contactDetails: z.enum(["MASK", "BLOCK"]).default("MASK"), flagRateTalk: z.boolean().default(true) }).default(() => ({ contactDetails: "MASK" as const, flagRateTalk: true })),
  /** v2 phase 6a: pasted interview links must sit on one of these hosts (the configured provider is always allowed). */
  meetings: z.object({ allowedHosts: z.array(z.string().trim().min(3)).default(["meet.hirewise.example", "zoom.us", "meet.google.com", "teams.microsoft.com", "teams.live.com"]), requireProvider: z.boolean().default(false) }).default(() => ({ allowedHosts: ["meet.hirewise.example", "zoom.us", "meet.google.com", "teams.microsoft.com", "teams.live.com"], requireProvider: false })),
  /** v2 phase 6a: email aliases. Inbound routing stays off until the email provider can deliver to the webhook. */
  email: z.object({ aliasDomain: z.string().trim().min(3).default("hirewiseconnect.com"), inboundEnabled: z.boolean().default(false) }).default(() => ({ aliasDomain: "hirewiseconnect.com", inboundEnabled: false })),
  /** v2 phase 6b: submission eligibility (decision 6). */
  opportunities: z.object({ requireActiveCredentials: z.boolean().default(true), maxSubmissionsPerAgency: z.number().int().min(1).max(50).default(5) }).default(() => ({ requireActiveCredentials: true, maxSubmissionsPerAgency: 5 })),
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
  /** Coach Wallet. Money is integer minor units. The coach share is locked on each earning at the sale. */
  coachWallet: z
    .object({
      coachShareBps: z.number().int().min(0).max(8000).default(6000),
      /** Days a buyer can still get a refund; match the refund policy. */
      refundWindowDays: z.number().int().min(0).max(365).default(14),
      /** Extra days on top of the refund window before an earning is withdrawable. */
      holdBufferDays: z.number().int().min(0).max(365).default(7),
      minimumWithdrawalMinor: z.number().int().min(0).default(50_000),
      /** Coaches see the buyer's first name and last initial only; this adds the email. Phone is never shown. */
      showBuyerEmail: z.boolean().default(false),
    })
    .default(() => ({ coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false })),
  /** Public Academy. With requireApproval off, a coach publishes their own course (it still needs a published lesson). */
  academy: z.object({ requireApproval: z.boolean().default(true) }).default(() => ({ requireApproval: true })),
  /** Promo codes: a use reserved on an unpaid enrolment is released after this many days. */
  promos: z.object({ reservationDays: z.number().int().min(1).max(90).default(7) }).default(() => ({ reservationDays: 7 })),
  /** Referral affiliate program. Money is integer minor units of payoutCurrency (USD cents by default). */
  referrals: z
    .object({
      commissionRateBps: z.number().int().min(0).max(10000).default(1500),
      holdDays: z.number().int().min(0).max(365).default(30),
      cookieDays: z.number().int().min(1).max(365).default(30),
      minimumPayoutMinor: z.number().int().min(0).default(50_000),
      payoutCurrency: z.string().length(3).default("PHP"),
    })
    .default(() => ({ commissionRateBps: 1500, holdDays: 30, cookieDays: 30, minimumPayoutMinor: 50_000, payoutCurrency: "PHP" })),
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
