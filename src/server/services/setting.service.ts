import { z } from "zod";
import type { Actor } from "@/server/auth/actor";
import type { PrismaClient } from "@/server/db/types";
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
  /** Section 8.8 thresholds. */
  profileViewBurstPerHour: z.number().int().positive().default(60),
  shortlistChurnPerDay: z.number().int().positive().default(12),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export async function getSetting<K extends SettingKey>(db: PrismaClient, key: K): Promise<SettingValue<K>> {
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
