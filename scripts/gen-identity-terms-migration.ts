/**
 * Prints the SQL for prisma/migrations/20261014090001_identity_terms_data/migration.sql.
 * The terms bodies and checksums come from src/server/terms/placeholder-terms.ts so the migration,
 * the seed, and the tests agree byte for byte. Re-run after changing a placeholder section:
 *   npx tsx scripts/gen-identity-terms-migration.ts > prisma/migrations/20261014090001_identity_terms_data/migration.sql
 */
import { createHash } from "node:crypto";
import { PLATFORM_TERMS_SECTIONS, PRIVACY_POLICY_SECTIONS, PLATFORM_TERMS_TITLE, PRIVACY_POLICY_TITLE, renderTermsBody } from "../src/server/terms/placeholder-terms";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const checksum = (body: string) => createHash("sha256").update(body).digest("hex");

const terms = renderTermsBody(PLATFORM_TERMS_TITLE, PLATFORM_TERMS_SECTIONS);
const privacy = renderTermsBody(PRIVACY_POLICY_TITLE, PRIVACY_POLICY_SECTIONS);
const termsRoles = `ARRAY['AGENT','CLIENT','APPLICANT','AGENCY_OWNER','AGENCY_MANAGER']::"RoleKey"[]`;

const sql = `-- Identity phase 1, data step. Runs after the schema step so the new enum values are usable.
-- Everything here is idempotent and additive: no row is deleted and no acceptance is altered.

-- One non-archived profile per user and per platform identity (the spec's "exactly one ACTIVE TalentProfile").
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProfile_one_active_per_user"
  ON "AgentProfile" ("userId")
  WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProfile_one_active_per_identity"
  ON "AgentProfile" ("platformIdentityId")
  WHERE "archivedAt" IS NULL AND "platformIdentityId" IS NOT NULL;

-- Backfill: one PlatformIdentity per existing talent profile owner and per applicant.
INSERT INTO "PlatformIdentity" ("id", "userId", "status", "primaryEmail", "verifiedAt", "createdAt", "updatedAt")
SELECT 'pi_' || substr(md5(u."id"), 1, 24), u."id", 'ACTIVE', u."email", u."emailVerifiedAt", now(), now()
FROM "User" u
LEFT JOIN "PlatformIdentity" pi ON pi."userId" = u."id"
WHERE pi."id" IS NULL
  AND (EXISTS (SELECT 1 FROM "AgentProfile" ap WHERE ap."userId" = u."id")
       OR EXISTS (SELECT 1 FROM "Role" r WHERE r."id" = u."roleId" AND r."key" = 'APPLICANT'));

INSERT INTO "PlatformIdentityContact" ("id", "identityId", "kind", "valueNormalized", "valueDisplay", "verifiedAt", "source", "createdAt")
SELECT 'pic_' || substr(md5(pi."id" || ':email:' || lower(trim(u."email"))), 1, 24), pi."id", 'EMAIL', lower(trim(u."email")), u."email", u."emailVerifiedAt", 'BACKFILL', now()
FROM "PlatformIdentity" pi JOIN "User" u ON u."id" = pi."userId"
ON CONFLICT ("identityId", "kind", "valueNormalized") DO NOTHING;

INSERT INTO "PlatformIdentityContact" ("id", "identityId", "kind", "valueNormalized", "valueDisplay", "source", "createdAt")
SELECT 'pic_' || substr(md5(pi."id" || ':email:' || lower(trim(pc."personalEmail"))), 1, 24), pi."id", 'EMAIL', lower(trim(pc."personalEmail")), pc."personalEmail", 'BACKFILL', now()
FROM "AgentPrivateContact" pc
JOIN "AgentProfile" ap ON ap."id" = pc."agentProfileId"
JOIN "PlatformIdentity" pi ON pi."userId" = ap."userId"
WHERE pc."personalEmail" IS NOT NULL AND trim(pc."personalEmail") <> ''
ON CONFLICT ("identityId", "kind", "valueNormalized") DO NOTHING;

INSERT INTO "PlatformIdentityContact" ("id", "identityId", "kind", "valueNormalized", "valueDisplay", "source", "createdAt")
SELECT 'pic_' || substr(md5(pi."id" || ':phone:' || regexp_replace(regexp_replace(pc."phone", '[^0-9+]', '', 'g'), '^00', '+')), 1, 24), pi."id", 'PHONE',
       regexp_replace(regexp_replace(pc."phone", '[^0-9+]', '', 'g'), '^00', '+'), pc."phone", 'BACKFILL', now()
FROM "AgentPrivateContact" pc
JOIN "AgentProfile" ap ON ap."id" = pc."agentProfileId"
JOIN "PlatformIdentity" pi ON pi."userId" = ap."userId"
WHERE pc."phone" IS NOT NULL AND length(regexp_replace(pc."phone", '[^0-9]', '', 'g')) >= 6
ON CONFLICT ("identityId", "kind", "valueNormalized") DO NOTHING;

UPDATE "AgentProfile" ap
SET "platformIdentityId" = pi."id",
    "talentType" = CASE WHEN ap."primaryAgencyId" IS NOT NULL THEN 'AGENCY_AGENT'::"TalentType" ELSE 'HIREWISE_DIRECT'::"TalentType" END
FROM "PlatformIdentity" pi
WHERE pi."userId" = ap."userId" AND ap."platformIdentityId" IS NULL;

-- Unified terms v1 and privacy policy v1 (PLACEHOLDER text; counsel replaces it through Staff > Agreements).
INSERT INTO "Agreement" ("id", "type", "version", "title", "bodyMarkdown", "bodyChecksum", "effectiveFrom", "isActive", "requiredForRoles", "sections", "isMaterialChange", "requiresReacceptance", "privacyPolicyMode", "changeNote", "publishedAt", "createdAt", "updatedAt")
SELECT 'agr_platform_terms_v1', 'PLATFORM_TERMS', 1, ${q(PLATFORM_TERMS_TITLE)}, ${q(terms)}, ${q(checksum(terms))}, TIMESTAMP '2026-10-14 00:00:00', true, ${termsRoles}, ${q(JSON.stringify(PLATFORM_TERMS_SECTIONS))}::jsonb, true, true, 'COMBINED', 'Initial unified terms (placeholder text).', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Agreement" WHERE "type" = 'PLATFORM_TERMS' AND "version" = 1);

INSERT INTO "Agreement" ("id", "type", "version", "title", "bodyMarkdown", "bodyChecksum", "effectiveFrom", "isActive", "requiredForRoles", "sections", "isMaterialChange", "requiresReacceptance", "privacyPolicyMode", "changeNote", "publishedAt", "createdAt", "updatedAt")
SELECT 'agr_privacy_policy_v1', 'PRIVACY_POLICY', 1, ${q(PRIVACY_POLICY_TITLE)}, ${q(privacy)}, ${q(checksum(privacy))}, TIMESTAMP '2026-10-14 00:00:00', true, ${termsRoles}, ${q(JSON.stringify(PRIVACY_POLICY_SECTIONS))}::jsonb, true, true, 'COMBINED', 'Initial privacy policy (placeholder text).', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Agreement" WHERE "type" = 'PRIVACY_POLICY' AND "version" = 1);

-- The separate per-role documents are superseded by the unified terms. Versions and acceptances stay as history.
UPDATE "Agreement" SET "isActive" = false
WHERE "isActive" = true AND "type" IN (
  'CLIENT_TOS','CLIENT_PRIVACY','CLIENT_HIRING_TERMS','CLIENT_NON_CIRCUMVENTION','CLIENT_COMMUNICATION',
  'AGENT_PLATFORM_TERMS','AGENT_PRIVACY','AGENT_REPRESENTATION','AGENT_NON_CIRCUMVENTION','AGENT_CLIENT_COMMUNICATION','AGENT_CONFIDENTIALITY',
  'AGENCY_NON_CIRCUMVENTION','SUBMISSION_TERMS'
);

-- Role at acceptance for historical rows, from the user's current role (best available information).
UPDATE "AgreementAcceptance" aa
SET "role" = r."key"
FROM "User" u JOIN "Role" r ON r."id" = u."roleId"
WHERE aa."userId" = u."id" AND aa."role" IS NULL;
`;
process.stdout.write(sql);
