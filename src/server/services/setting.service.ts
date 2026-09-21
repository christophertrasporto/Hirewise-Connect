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
