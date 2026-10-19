-- v2 phase 5, data step. Idempotent. Runs after the schema step so the new enum values are usable.

-- Partner Team codes: the sequence feeds HWC-### at approval; existing agencies get codes in join order.
CREATE SEQUENCE IF NOT EXISTS "agency_client_code_seq" START 1;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "Agency" WHERE "clientFacingCode" IS NULL ORDER BY "joinedAt", "id" LOOP
    UPDATE "Agency" SET "clientFacingCode" = 'HWC-' || lpad(nextval('agency_client_code_seq')::text, 3, '0') WHERE "id" = r."id";
  END LOOP;
END $$;

UPDATE "Agency" SET "clientFacingName" = 'Hirewise Certified Partner Team ' || "clientFacingCode"
WHERE "clientFacingName" IS NULL AND "clientFacingCode" IS NOT NULL;

-- Client labels (decision 1): first name plus last initial from the legal name, else from the display name.
UPDATE "AgentProfile" p SET "clientLabel" = sub.label FROM (
  SELECT p2."id",
    CASE WHEN array_length(p2.parts, 1) >= 2 THEN p2.parts[1] || ' ' || left(p2.parts[array_length(p2.parts, 1)], 1) || '.' ELSE p2.parts[1] END AS label
  FROM (
    SELECT p3."id", regexp_split_to_array(btrim(regexp_replace(COALESCE(NULLIF(btrim(c."fullLegalName"), ''), p3."displayName"), '\s+', ' ', 'g')), ' ') AS parts
    FROM "AgentProfile" p3 LEFT JOIN "AgentPrivateContact" c ON c."agentProfileId" = p3."id"
  ) p2
) sub WHERE p."id" = sub."id" AND p."clientLabel" IS NULL;

-- One active grant per scope, client, and subject.
CREATE UNIQUE INDEX IF NOT EXISTS "DisclosureGrant_active_unique"
  ON "DisclosureGrant" ("scope", "clientId", COALESCE("agentProfileId", ''), COALESCE("agencyId", ''))
  WHERE "revokedAt" IS NULL;

-- Client-safe rows for what clients could already see (decision 5): media waits for manual approval,
-- generated certificate and profile PDFs are produced by the worker from PENDING rows.
INSERT INTO "ClientSafeDocument" ("id", "agentProfileId", "type", "sourceType", "sourceId", "originalStorageKey", "status", "autoNote", "createdAt", "updatedAt")
SELECT 'csd' || md5('VIDEO' || v."id"), v."agentProfileId", 'VIDEO_INTRO', 'VIDEO', v."id", v."storageKey", 'NEEDS_MANUAL_REVIEW', 'Video content cannot be scanned automatically.', now(), now()
FROM "Video" v WHERE v."status" = 'APPROVED'
ON CONFLICT ("sourceType", "sourceId", "originalStorageKey") DO NOTHING;

INSERT INTO "ClientSafeDocument" ("id", "agentProfileId", "type", "sourceType", "sourceId", "originalStorageKey", "status", "autoNote", "createdAt", "updatedAt")
SELECT 'csd' || md5('RECORDING' || r."id"), r."agentProfileId", 'VOICE_INTRO', 'RECORDING', r."id", r."storageKey", 'NEEDS_MANUAL_REVIEW', 'Audio content cannot be scanned automatically.', now(), now()
FROM "Recording" r WHERE r."status" = 'APPROVED'
ON CONFLICT ("sourceType", "sourceId", "originalStorageKey") DO NOTHING;

INSERT INTO "ClientSafeDocument" ("id", "agentProfileId", "type", "sourceType", "sourceId", "originalStorageKey", "status", "autoNote", "createdAt", "updatedAt")
SELECT 'csd' || md5('PORTFOLIO' || i."id"), i."agentProfileId", 'PORTFOLIO', 'PORTFOLIO', i."id", COALESCE(i."storageKey", i."url"), 'NEEDS_MANUAL_REVIEW', 'Uploaded files and external links need a reviewer.', now(), now()
FROM "Portfolio" i WHERE i."status" = 'APPROVED' AND COALESCE(i."storageKey", i."url") IS NOT NULL
ON CONFLICT ("sourceType", "sourceId", "originalStorageKey") DO NOTHING;

INSERT INTO "ClientSafeDocument" ("id", "agentProfileId", "type", "sourceType", "sourceId", "originalStorageKey", "status", "createdAt", "updatedAt")
SELECT 'csd' || md5('CERTIFICATION' || c."id"), c."agentProfileId", 'CERTIFICATE', 'CERTIFICATION', c."id", 'generated:certificate:' || c."id", 'PENDING', now(), now()
FROM "Certification" c WHERE c."status" = 'APPROVED'
ON CONFLICT ("sourceType", "sourceId", "originalStorageKey") DO NOTHING;

INSERT INTO "ClientSafeDocument" ("id", "agentProfileId", "type", "sourceType", "sourceId", "originalStorageKey", "status", "createdAt", "updatedAt")
SELECT 'csd' || md5('PROFILE' || p."id"), p."id", 'PROFILE', 'PROFILE', p."id", 'generated:profile:' || p."id", 'PENDING', now(), now()
FROM "AgentProfile" p WHERE p."status" = 'APPROVED' AND p."deletedAt" IS NULL
ON CONFLICT ("sourceType", "sourceId", "originalStorageKey") DO NOTHING;

-- Disclosure grants that make today's implicit reveals explicit (decision 6):
-- the client learned the candidate's identity when an interview was scheduled, and direct talent learned the client's.
INSERT INTO "DisclosureGrant" ("id", "scope", "clientId", "agentProfileId", "agencyId", "grantedBy", "grantedById", "reason", "interviewId", "grantedAt")
SELECT 'dg' || md5('AI' || r."clientId" || c."agentProfileId"), 'AGENT_IDENTITY', r."clientId", c."agentProfileId", NULL, 'SYSTEM', NULL, 'Interview scheduled before client protection (backfill)', NULL, now()
FROM "InterviewRequestCandidate" c JOIN "InterviewRequest" r ON r."id" = c."interviewRequestId"
WHERE r."status" IN ('SCHEDULED', 'COMPLETED', 'CLIENT_DECISION_PENDING', 'CLOSED') AND c."status" NOT IN ('DECLINED', 'WITHDRAWN')
  AND NOT EXISTS (SELECT 1 FROM "DisclosureGrant" g WHERE g."scope" = 'AGENT_IDENTITY' AND g."clientId" = r."clientId" AND g."agentProfileId" = c."agentProfileId" AND g."revokedAt" IS NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "DisclosureGrant" ("id", "scope", "clientId", "agentProfileId", "agencyId", "grantedBy", "grantedById", "reason", "interviewId", "grantedAt")
SELECT 'dg' || md5('CI' || r."clientId" || c."agentProfileId"), 'CLIENT_IDENTITY', r."clientId", c."agentProfileId", NULL, 'SYSTEM', NULL, 'Interview scheduled before client protection (backfill)', NULL, now()
FROM "InterviewRequestCandidate" c JOIN "InterviewRequest" r ON r."id" = c."interviewRequestId" JOIN "AgentProfile" p ON p."id" = c."agentProfileId"
WHERE r."status" IN ('SCHEDULED', 'COMPLETED', 'CLIENT_DECISION_PENDING', 'CLOSED') AND c."status" NOT IN ('DECLINED', 'WITHDRAWN') AND p."primaryAgencyId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "DisclosureGrant" g WHERE g."scope" = 'CLIENT_IDENTITY' AND g."clientId" = r."clientId" AND g."agentProfileId" = c."agentProfileId" AND g."revokedAt" IS NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "DisclosureGrant" ("id", "scope", "clientId", "agentProfileId", "agencyId", "grantedBy", "grantedById", "reason", "interviewId", "grantedAt")
SELECT 'dg' || md5('CIP' || pl."clientId" || pl."agentProfileId"), 'CLIENT_IDENTITY', pl."clientId", pl."agentProfileId", NULL, 'SYSTEM', NULL, 'Placement existed before client protection (backfill)', NULL, now()
FROM "Placement" pl
WHERE NOT EXISTS (SELECT 1 FROM "DisclosureGrant" g WHERE g."scope" = 'CLIENT_IDENTITY' AND g."clientId" = pl."clientId" AND g."agentProfileId" = pl."agentProfileId" AND g."revokedAt" IS NULL)
ON CONFLICT DO NOTHING;
