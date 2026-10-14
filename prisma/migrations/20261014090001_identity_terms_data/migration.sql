-- Identity phase 1, data step. Runs after the schema step so the new enum values are usable.
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
SELECT 'agr_platform_terms_v1', 'PLATFORM_TERMS', 1, 'Hirewise Connect Terms & Platform Agreement', '# Hirewise Connect Terms & Platform Agreement

> LEGAL_PLACEHOLDER - replace with counsel-approved text before launch.

## 1. Definitions and parties

LEGAL_PLACEHOLDER - counsel-approved text for "definitions, Hirewise Connect as the platform, who the parties are" goes here. This section is a placeholder and carries no legal effect.

## 2. Account rules and acceptable use

LEGAL_PLACEHOLDER - counsel-approved text for "account rules, one person one identity, accurate information, acceptable use" goes here. This section is a placeholder and carries no legal effect.

## 3. Hirewise Connect''s role

LEGAL_PLACEHOLDER - counsel-approved text for "Hirewise controls client acquisition, pricing, proposals, placement, communication, billing, and platform rules" goes here. This section is a placeholder and carries no legal effect.

## 4. Agency membership

LEGAL_PLACEHOLDER - counsel-approved text for "what joining an agency on the platform means, invitation links, seats, membership records" goes here. This section is a placeholder and carries no legal effect.

## 5. Agent exclusivity

LEGAL_PLACEHOLDER - counsel-approved text for "one active agency at a time, no second profile, no direct submissions or client contact while a membership is active" goes here. This section is a placeholder and carries no legal effect.

## 6. Agent Seats and seat usage

LEGAL_PLACEHOLDER - counsel-approved text for "agent seat capacity, seat packages, seat release rules, no seat removal below usage without Hirewise" goes here. This section is a placeholder and carries no legal effect.

## 7. Course access

LEGAL_PLACEHOLDER - counsel-approved text for "course access, enrolment sources, what happens to access when a sponsorship ends" goes here. This section is a placeholder and carries no legal effect.

## 8. Training sponsorship

LEGAL_PLACEHOLDER - counsel-approved text for "agency-sponsored training, who pays, who owns the outcome" goes here. This section is a placeholder and carries no legal effect.

## 9. Certification ownership and revocation

LEGAL_PLACEHOLDER - counsel-approved text for "certifications issued by Hirewise, agency-funded certifications becoming inactive for platform use on exit, re-earning as independent" goes here. This section is a placeholder and carries no legal effect.

## 10. Assessments

LEGAL_PLACEHOLDER - counsel-approved text for "assessments, historical status after exit, use in eligibility" goes here. This section is a placeholder and carries no legal effect.

## 11. Leaving an agency

LEGAL_PLACEHOLDER - counsel-approved text for "request to leave, agency removal, Hirewise review, effective dates, exit actions" goes here. This section is a placeholder and carries no legal effect.

## 12. Independent reapplication

LEGAL_PLACEHOLDER - counsel-approved text for "applying as an independent freelancer after an agency membership ends, fresh profile, no inherited credentials" goes here. This section is a placeholder and carries no legal effect.

## 13. Client opportunities

LEGAL_PLACEHOLDER - counsel-approved text for "opportunities shared by Hirewise, submissions, eligibility, masked client details until disclosure" goes here. This section is a placeholder and carries no legal effect.

## 14. Client communications and platform messaging

LEGAL_PLACEHOLDER - counsel-approved text for "all pre-placement communication on the platform, contact details, interviews scheduled by Hirewise" goes here. This section is a placeholder and carries no legal effect.

## 15. Direct hiring and non-circumvention

LEGAL_PLACEHOLDER - counsel-approved text for "no direct hiring or engagement outside Hirewise, duration, reporting, consequences" goes here. This section is a placeholder and carries no legal effect.

## 16. Payments and refunds

LEGAL_PLACEHOLDER - counsel-approved text for "payments, invoices, deposits, seat packages, course purchases, refunds" goes here. This section is a placeholder and carries no legal effect.

## 17. Suspension and termination

LEGAL_PLACEHOLDER - counsel-approved text for "warnings, restrictions, suspension, termination, effect on memberships and data" goes here. This section is a placeholder and carries no legal effect.

## 18. Data and privacy

LEGAL_PLACEHOLDER - counsel-approved text for "reference to the Privacy Policy, identity records, what clients and agencies can see" goes here. This section is a placeholder and carries no legal effect.

## 19. Intellectual property

LEGAL_PLACEHOLDER - counsel-approved text for "platform content, course materials, recordings licence, trademarks" goes here. This section is a placeholder and carries no legal effect.

## 20. Dispute process

LEGAL_PLACEHOLDER - counsel-approved text for "how disputes are raised and resolved, escalation" goes here. This section is a placeholder and carries no legal effect.

## 21. Governing law

LEGAL_PLACEHOLDER - counsel-approved text for "governing law and venue" goes here. This section is a placeholder and carries no legal effect.
', '6dda7c8665bad3ab166cd697a4b8bed5736dfc171ca4d144c76451c4695107ae', TIMESTAMP '2026-10-14 00:00:00', true, ARRAY['AGENT','CLIENT','APPLICANT','AGENCY_OWNER','AGENCY_MANAGER']::"RoleKey"[], '[{"key":"general.definitions","title":"Definitions and parties","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"definitions, Hirewise Connect as the platform, who the parties are\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.account","title":"Account rules and acceptable use","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"account rules, one person one identity, accurate information, acceptable use\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.role","title":"Hirewise Connect''s role","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"Hirewise controls client acquisition, pricing, proposals, placement, communication, billing, and platform rules\" goes here. This section is a placeholder and carries no legal effect."},{"key":"agent.membership","title":"Agency membership","audiences":["AGENT","AGENCY_OWNER"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"what joining an agency on the platform means, invitation links, seats, membership records\" goes here. This section is a placeholder and carries no legal effect."},{"key":"agent.exclusivity","title":"Agent exclusivity","audiences":["AGENT","AGENCY_OWNER"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"one active agency at a time, no second profile, no direct submissions or client contact while a membership is active\" goes here. This section is a placeholder and carries no legal effect."},{"key":"agency.seats","title":"Agent Seats and seat usage","audiences":["AGENCY_OWNER"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"agent seat capacity, seat packages, seat release rules, no seat removal below usage without Hirewise\" goes here. This section is a placeholder and carries no legal effect."},{"key":"training.access","title":"Course access","audiences":["TRAINING"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"course access, enrolment sources, what happens to access when a sponsorship ends\" goes here. This section is a placeholder and carries no legal effect."},{"key":"training.sponsorship","title":"Training sponsorship","audiences":["TRAINING","AGENCY_OWNER"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"agency-sponsored training, who pays, who owns the outcome\" goes here. This section is a placeholder and carries no legal effect."},{"key":"training.certifications","title":"Certification ownership and revocation","audiences":["TRAINING"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"certifications issued by Hirewise, agency-funded certifications becoming inactive for platform use on exit, re-earning as independent\" goes here. This section is a placeholder and carries no legal effect."},{"key":"training.assessments","title":"Assessments","audiences":["TRAINING"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"assessments, historical status after exit, use in eligibility\" goes here. This section is a placeholder and carries no legal effect."},{"key":"agent.leaving","title":"Leaving an agency","audiences":["AGENT","AGENCY_OWNER"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"request to leave, agency removal, Hirewise review, effective dates, exit actions\" goes here. This section is a placeholder and carries no legal effect."},{"key":"agent.independent","title":"Independent reapplication","audiences":["AGENT"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"applying as an independent freelancer after an agency membership ends, fresh profile, no inherited credentials\" goes here. This section is a placeholder and carries no legal effect."},{"key":"client.opportunities","title":"Client opportunities","audiences":["CLIENT","AGENCY_OWNER","AGENT"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"opportunities shared by Hirewise, submissions, eligibility, masked client details until disclosure\" goes here. This section is a placeholder and carries no legal effect."},{"key":"client.communications","title":"Client communications and platform messaging","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"all pre-placement communication on the platform, contact details, interviews scheduled by Hirewise\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.circumvention","title":"Direct hiring and non-circumvention","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"no direct hiring or engagement outside Hirewise, duration, reporting, consequences\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.payments","title":"Payments and refunds","audiences":["CLIENT","AGENCY_OWNER","AGENT"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"payments, invoices, deposits, seat packages, course purchases, refunds\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.suspension","title":"Suspension and termination","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"warnings, restrictions, suspension, termination, effect on memberships and data\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.privacy","title":"Data and privacy","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"reference to the Privacy Policy, identity records, what clients and agencies can see\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.ip","title":"Intellectual property","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"platform content, course materials, recordings licence, trademarks\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.disputes","title":"Dispute process","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"how disputes are raised and resolved, escalation\" goes here. This section is a placeholder and carries no legal effect."},{"key":"general.law","title":"Governing law","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"governing law and venue\" goes here. This section is a placeholder and carries no legal effect."}]'::jsonb, true, true, 'COMBINED', 'Initial unified terms (placeholder text).', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Agreement" WHERE "type" = 'PLATFORM_TERMS' AND "version" = 1);

INSERT INTO "Agreement" ("id", "type", "version", "title", "bodyMarkdown", "bodyChecksum", "effectiveFrom", "isActive", "requiredForRoles", "sections", "isMaterialChange", "requiresReacceptance", "privacyPolicyMode", "changeNote", "publishedAt", "createdAt", "updatedAt")
SELECT 'agr_privacy_policy_v1', 'PRIVACY_POLICY', 1, 'Hirewise Connect Privacy Policy', '# Hirewise Connect Privacy Policy

> LEGAL_PLACEHOLDER - replace with counsel-approved text before launch.

## 1. Data we collect

LEGAL_PLACEHOLDER - counsel-approved text for "account, identity, profile, training, placement, and usage data" goes here. This section is a placeholder and carries no legal effect.

## 2. How we use data

LEGAL_PLACEHOLDER - counsel-approved text for "purposes: matching, training, placement, billing, platform safety, duplicate detection" goes here. This section is a placeholder and carries no legal effect.

## 3. What clients and agencies can see

LEGAL_PLACEHOLDER - counsel-approved text for "client-safe profiles, partner team identities, disclosure grants, what is never shared" goes here. This section is a placeholder and carries no legal effect.

## 4. Retention

LEGAL_PLACEHOLDER - counsel-approved text for "retention periods, archived profiles, identity history" goes here. This section is a placeholder and carries no legal effect.

## 5. Your rights

LEGAL_PLACEHOLDER - counsel-approved text for "access, correction, deletion requests, contact" goes here. This section is a placeholder and carries no legal effect.
', 'da0b92ba59c760373279f7d13d417946e0b41b0decec90ea819e9eec083575e9', TIMESTAMP '2026-10-14 00:00:00', true, ARRAY['AGENT','CLIENT','APPLICANT','AGENCY_OWNER','AGENCY_MANAGER']::"RoleKey"[], '[{"key":"privacy.collected","title":"Data we collect","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"account, identity, profile, training, placement, and usage data\" goes here. This section is a placeholder and carries no legal effect."},{"key":"privacy.use","title":"How we use data","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"purposes: matching, training, placement, billing, platform safety, duplicate detection\" goes here. This section is a placeholder and carries no legal effect."},{"key":"privacy.sharing","title":"What clients and agencies can see","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"client-safe profiles, partner team identities, disclosure grants, what is never shared\" goes here. This section is a placeholder and carries no legal effect."},{"key":"privacy.retention","title":"Retention","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"retention periods, archived profiles, identity history\" goes here. This section is a placeholder and carries no legal effect."},{"key":"privacy.rights","title":"Your rights","audiences":["ALL"],"bodyMarkdown":"LEGAL_PLACEHOLDER - counsel-approved text for \"access, correction, deletion requests, contact\" goes here. This section is a placeholder and carries no legal effect."}]'::jsonb, true, true, 'COMBINED', 'Initial privacy policy (placeholder text).', now(), now(), now()
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
