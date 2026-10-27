-- A live (reserved or consumed) redemption is unique per enrolment: one code per enrolment.
CREATE UNIQUE INDEX "PromoRedemption_one_live_per_enrollment" ON "PromoRedemption"("enrollmentId") WHERE "status" IN ('RESERVED', 'CONSUMED');

-- A code's discount is well formed, whatever wrote it.
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_discount_shape" CHECK (
  ("discountType" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amountMinor" IS NULL)
  OR ("discountType" = 'AMOUNT' AND "amountMinor" > 0 AND "currency" IS NOT NULL AND "percentBps" IS NULL)
);
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_limits_sane" CHECK ("perLearnerLimit" >= 1 AND ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1) AND "minPriceMinor" >= 0 AND ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"));
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$');

-- A redemption's arithmetic always adds up.
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_amounts_add_up" CHECK ("discountMinor" >= 0 AND "finalMinor" >= 0 AND "finalMinor" = "listPriceMinor" - "discountMinor");
