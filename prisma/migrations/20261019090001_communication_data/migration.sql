-- v2 phase 6a, data step. Idempotent. Runs after the schema step so the new enum values are usable.

-- One thread per existing interview request; the old InterviewMessage rows are copied (same ids) and kept as history.
INSERT INTO "MessageThread" ("id", "kind", "subjectType", "subjectId", "interviewRequestId", "clientId", "title", "status", "assignedStaffUserId", "lastMessageAt", "createdAt", "closedAt")
SELECT 'thr' || md5('IR' || r."id"), 'INTERVIEW_REQUEST', 'InterviewRequest', r."id", r."id", r."clientId", 'Interview request: ' || r."role",
       (CASE WHEN r."status" IN ('CANCELLED', 'CLOSED') THEN 'CLOSED' ELSE 'OPEN' END)::"ThreadStatus",
       r."assignedSalesUserId",
       (SELECT max(m."createdAt") FROM "InterviewMessage" m WHERE m."interviewRequestId" = r."id"),
       r."createdAt",
       CASE WHEN r."status" IN ('CANCELLED', 'CLOSED') THEN r."updatedAt" ELSE NULL END
FROM "InterviewRequest" r
WHERE NOT EXISTS (SELECT 1 FROM "MessageThread" t WHERE t."interviewRequestId" = r."id");

INSERT INTO "Message" ("id", "threadId", "authorUserId", "authorRole", "body", "originalBody", "findings", "visibleTo", "heldForReview", "maskedAt", "releasedById", "releasedAt", "blockedAt", "createdAt")
SELECT m."id", t."id", m."authorUserId", m."authorRole", m."body", NULL, '{}', m."visibleTo", m."heldForReview", NULL, m."releasedById", m."releasedAt", m."blockedAt", m."createdAt"
FROM "InterviewMessage" m JOIN "MessageThread" t ON t."interviewRequestId" = m."interviewRequestId"
ON CONFLICT ("id") DO NOTHING;

-- Email aliases: talent#### for approved agents, team#### for agencies. The sequence continues from here.
CREATE SEQUENCE IF NOT EXISTS "email_alias_seq" START 1001;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "AgentProfile" WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL ORDER BY "approvedAt", "id" LOOP
    INSERT INTO "EmailAlias" ("id", "alias", "ownerType", "ownerId", "active", "createdAt")
    VALUES ('als' || md5('AP' || r."id"), 'talent' || nextval('email_alias_seq')::text || '@hirewiseconnect.com', 'AGENT_PROFILE', r."id", true, now())
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR r IN SELECT "id" FROM "Agency" WHERE "status" = 'ACTIVE' ORDER BY "joinedAt", "id" LOOP
    INSERT INTO "EmailAlias" ("id", "alias", "ownerType", "ownerId", "active", "createdAt")
    VALUES ('als' || md5('AG' || r."id"), 'team' || nextval('email_alias_seq')::text || '@hirewiseconnect.com', 'AGENCY', r."id", true, now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Case history is append-only.
CREATE OR REPLACE FUNCTION bypass_report_event_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BypassReportEvent is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bypass_report_event_readonly ON "BypassReportEvent";
CREATE TRIGGER bypass_report_event_readonly BEFORE UPDATE OR DELETE ON "BypassReportEvent" FOR EACH ROW EXECUTE FUNCTION bypass_report_event_readonly();
