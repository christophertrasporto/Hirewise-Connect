-- The wallet ledger is append-only, like AuditLog and AgencySeatLedger: a balance is always the sum of its rows.
CREATE OR REPLACE FUNCTION wallet_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WalletLedgerEntry is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WalletLedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "WalletLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();

-- One open withdrawal request per coach, whatever wrote it.
CREATE UNIQUE INDEX "CoachWithdrawal_one_open_per_coach" ON "CoachWithdrawal"("coachUserId") WHERE "status" IN ('REQUESTED', 'APPROVED');

-- A split is well formed: the parts add up exactly, and nothing is negative or above the sale.
ALTER TABLE "CoachEarning" ADD CONSTRAINT "CoachEarning_split_adds_up" CHECK (
  "saleAmount" > 0
  AND "coachRateBps" BETWEEN 0 AND 10000
  AND "affiliateAmount" >= 0
  AND (
    ("gatewayFee" IS NULL AND "netAmount" IS NULL AND "coachAmount" IS NULL AND "platformAmount" IS NULL)
    OR (
      "gatewayFee" IS NOT NULL AND "netAmount" IS NOT NULL AND "coachAmount" IS NOT NULL AND "platformAmount" IS NOT NULL
      AND "gatewayFee" >= 0 AND "gatewayFee" <= "saleAmount"
      AND "netAmount" = "saleAmount" - "gatewayFee"
      AND "coachAmount" >= 0 AND "platformAmount" >= 0
      AND "coachAmount" + "platformAmount" = "netAmount"
    )
  )
);

-- A pending-fee earning has no amounts yet; every other live status has them.
ALTER TABLE "CoachEarning" ADD CONSTRAINT "CoachEarning_status_matches_amounts" CHECK (
  ("status" = 'PENDING_FEE' AND "coachAmount" IS NULL)
  OR ("status" = 'REVERSED')
  OR ("status" IN ('ON_HOLD', 'AVAILABLE', 'WITHDRAWN') AND "coachAmount" IS NOT NULL)
);

ALTER TABLE "CoachWithdrawal" ADD CONSTRAINT "CoachWithdrawal_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "CoachShareOverride" ADD CONSTRAINT "CoachShareOverride_share_range" CHECK ("shareBps" BETWEEN 0 AND 10000);
