-- Referral program guards. Attribution is permanent and nobody earns on their own purchase.

ALTER TABLE "User" ADD CONSTRAINT "User_referral_not_self" CHECK ("referredByUserId" IS NULL OR "referredByUserId" <> "id");

CREATE OR REPLACE FUNCTION hw_user_referral_write_once() RETURNS trigger AS $$
BEGIN
  IF OLD."referredByUserId" IS NOT NULL AND (NEW."referredByUserId" IS DISTINCT FROM OLD."referredByUserId" OR NEW."referredAt" IS DISTINCT FROM OLD."referredAt") THEN
    RAISE EXCEPTION 'User.referredByUserId is write-once' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_referral_write_once BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION hw_user_referral_write_once();

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_buyer_not_referrer" CHECK ("buyerId" <> "referrerId");
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_amounts_valid" CHECK ("saleAmount" >= 0 AND "commissionAmount" >= 0 AND "rateBps" BETWEEN 0 AND 10000);
