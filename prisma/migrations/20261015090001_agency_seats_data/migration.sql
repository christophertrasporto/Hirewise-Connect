-- v2 phase 2, data step. Runs after the schema step so the new enum values are usable. Idempotent and additive.

-- The seat ledger is append-only, like AuditLog: totals are always computed from the rows.
CREATE OR REPLACE FUNCTION seat_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AgencySeatLedger is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seat_ledger_no_update ON "AgencySeatLedger";
CREATE TRIGGER seat_ledger_no_update
  BEFORE UPDATE ON "AgencySeatLedger"
  FOR EACH ROW EXECUTE FUNCTION seat_ledger_append_only();

DROP TRIGGER IF EXISTS seat_ledger_no_delete ON "AgencySeatLedger";
CREATE TRIGGER seat_ledger_no_delete
  BEFORE DELETE ON "AgencySeatLedger"
  FOR EACH ROW EXECUTE FUNCTION seat_ledger_append_only();

-- Membership rows know their platform identity (from the profile created in phase 1).
UPDATE "AgencyMembership" m
SET "platformIdentityId" = ap."platformIdentityId"
FROM "AgentProfile" ap
WHERE ap."id" = m."agentProfileId" AND m."platformIdentityId" IS NULL AND ap."platformIdentityId" IS NOT NULL;

-- Hirewise Direct is the absence of a membership (decision 1): historical null-agency rows are closed.
UPDATE "AgencyMembership"
SET "status" = 'ENDED', "leftAt" = COALESCE("leftAt", now()), "endReason" = COALESCE("endReason", 'Hirewise Direct is no longer recorded as a membership (v2 phase 2)')
WHERE "agencyId" IS NULL AND "status" <> 'ENDED';

-- One open membership per platform identity (the spec's exclusivity constraint at the database level).
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyMembership_one_open_per_identity"
  ON "AgencyMembership" ("platformIdentityId")
  WHERE "platformIdentityId" IS NOT NULL
    AND "status" IN ('INVITED', 'PENDING_VERIFICATION', 'ACTIVE', 'EXIT_REQUESTED', 'REMOVAL_REQUESTED', 'ENDING');

-- Plans and seat packages. Prices are placeholders (0) until Hirewise sets them under Staff > Agencies > Plans.
INSERT INTO "Plan" ("id", "key", "name", "baseAgentSeats", "priceMinor", "currency", "billingPeriod", "trainingAccess", "opportunityAccess", "features", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT v.id, v.key, v.name, v.seats, 0, 'USD', 'MONTHLY', true, true, v.features, true, v.sort, now(), now()
FROM (VALUES
  ('plan_starter', 'STARTER', 'Starter', 5, ARRAY['Up to 5 agent seats', 'Training marketplace', 'Client opportunities'], 1),
  ('plan_growth', 'GROWTH', 'Growth', 20, ARRAY['Up to 20 agent seats', 'Training marketplace', 'Client opportunities', 'Team reports'], 2),
  ('plan_professional', 'PROFESSIONAL', 'Professional', 50, ARRAY['Up to 50 agent seats', 'Training marketplace', 'Client opportunities', 'Team reports', 'Priority review'], 3),
  ('plan_enterprise', 'ENTERPRISE', 'Enterprise', NULL, ARRAY['Custom agent seats', 'Everything in Professional', 'Dedicated Hirewise contact'], 4)
) AS v(id, key, name, seats, features, sort)
WHERE NOT EXISTS (SELECT 1 FROM "Plan" p WHERE p."key" = v.key);

INSERT INTO "SeatPackage" ("id", "name", "seatCount", "priceMinor", "currency", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT v.id, v.name, v.seats, 0, 'USD', true, v.sort, now(), now()
FROM (VALUES
  ('pkg_5', '5 additional agent seats', 5, 1),
  ('pkg_10', '10 additional agent seats', 10, 2),
  ('pkg_25', '25 additional agent seats', 25, 3)
) AS v(id, name, seats, sort)
WHERE NOT EXISTS (SELECT 1 FROM "SeatPackage" s WHERE s."id" = v.id);
