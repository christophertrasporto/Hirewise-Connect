-- Course Builder phase 6: every existing certification gets a printed number and a verification code.
-- Numbers are HC-YYYY-NNNNNN, sequential per issue year in creation order; codes are derived from the id so
-- the migration is deterministic and idempotent. New rows are numbered by the application.
WITH numbered AS (
  SELECT id,
         EXTRACT(YEAR FROM "issuedAt")::int AS yr,
         ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM "issuedAt") ORDER BY "createdAt", id) AS n
  FROM "Certification"
  WHERE "certificateNumber" IS NULL
)
UPDATE "Certification" c
SET "certificateNumber" = 'HC-' || numbered.yr || '-' || LPAD(numbered.n::text, 6, '0')
FROM numbered
WHERE c.id = numbered.id
  AND NOT EXISTS (SELECT 1 FROM "Certification" x WHERE x."certificateNumber" = 'HC-' || numbered.yr || '-' || LPAD(numbered.n::text, 6, '0'));

UPDATE "Certification"
SET "verificationCode" = UPPER(SUBSTR(MD5(id || '-verify'), 1, 4) || '-' || SUBSTR(MD5(id || '-verify'), 5, 4) || '-' || SUBSTR(MD5(id || '-verify'), 9, 4))
WHERE "verificationCode" IS NULL;
