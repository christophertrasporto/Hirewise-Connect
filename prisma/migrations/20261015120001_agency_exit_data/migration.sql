-- v2 phase 3, data step. Idempotent and additive.

-- One open exit request per membership.
CREATE UNIQUE INDEX IF NOT EXISTS "ExitRequest_one_open_per_membership"
  ON "ExitRequest" ("membershipId")
  WHERE "status" IN ('PENDING_AGENCY', 'PENDING_ADMIN', 'APPROVED');

-- Memberships ended before phase 3 released their seat immediately; record that so pending-release counts stay correct.
UPDATE "AgencyMembership"
SET "seatReleasedAt" = COALESCE("leftAt", now()), "seatReleaseRule" = 'IMMEDIATE'
WHERE "status" = 'ENDED' AND "seatLedgerEntryId" IS NOT NULL AND "seatReleasedAt" IS NULL;
