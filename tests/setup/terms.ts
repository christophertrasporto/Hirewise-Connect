import type { PrismaClient } from "@/server/db/types";
import { createHash } from "node:crypto";
import { PLATFORM_TERMS_SECTIONS, PRIVACY_POLICY_SECTIONS, PLATFORM_TERMS_TITLE, PRIVACY_POLICY_TITLE, renderTermsBody } from "@/server/terms/placeholder-terms";

/** Seeds the unified terms and privacy policy v1 exactly as the data migration and the foundation seed do. */
export async function seedTerms(db: PrismaClient) {
  const docs = [
    { type: "PLATFORM_TERMS" as const, title: PLATFORM_TERMS_TITLE, sections: PLATFORM_TERMS_SECTIONS },
    { type: "PRIVACY_POLICY" as const, title: PRIVACY_POLICY_TITLE, sections: PRIVACY_POLICY_SECTIONS },
  ];
  const ids: Record<string, string> = {};
  for (const doc of docs) {
    const body = renderTermsBody(doc.title, doc.sections);
    const row = await db.agreement.upsert({
      where: { type_version: { type: doc.type, version: 1 } },
      create: { type: doc.type, version: 1, title: doc.title, bodyMarkdown: body, bodyChecksum: createHash("sha256").update(body).digest("hex"), effectiveFrom: new Date("2026-10-14"), isActive: true, requiredForRoles: ["AGENT", "CLIENT", "APPLICANT", "AGENCY_OWNER", "AGENCY_MANAGER"], sections: doc.sections, isMaterialChange: true, requiresReacceptance: true, privacyPolicyMode: "COMBINED", publishedAt: new Date("2026-10-14") },
      update: {},
    });
    ids[doc.type] = row.id;
  }
  return ids;
}
