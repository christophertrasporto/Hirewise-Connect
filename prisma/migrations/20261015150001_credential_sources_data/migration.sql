-- v2 phase 4, data step (decision 1). Idempotent. Nothing existing is agency sponsored.

-- Enrollments the agent paid for are independent purchases; waived ones are admin assignments; the rest Hirewise direct.
UPDATE "CourseEnrollment" SET "credentialSource" = 'INDEPENDENT_PURCHASE'
WHERE "paymentStatus" = 'PAID' AND "credentialSource" = 'HIREWISE_DIRECT' AND "sponsoringAgencyId" IS NULL;

UPDATE "CourseEnrollment" SET "credentialSource" = 'ADMIN_ASSIGNMENT'
WHERE "paymentStatus" = 'WAIVED' AND "credentialSource" = 'HIREWISE_DIRECT' AND "sponsoringAgencyId" IS NULL;

-- Certifications and assessments keep the HIREWISE_DIRECT default.
