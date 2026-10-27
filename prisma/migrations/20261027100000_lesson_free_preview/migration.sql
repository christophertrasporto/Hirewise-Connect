-- AlterTable
ALTER TABLE "CourseLesson" ADD COLUMN     "isFreePreview" BOOLEAN NOT NULL DEFAULT false;

-- Each course's single intro video becomes its first lesson, a free preview. The module and lesson are not required, so
-- completion percentages and certifications of existing learners do not change. Idempotent (fixed ids, ON CONFLICT DO
-- NOTHING); the course keeps its introVideoUrl.
INSERT INTO "CourseModule" ("id", "courseId", "order", "title", "description", "isRequired", "status", "createdAt", "updatedAt")
SELECT 'welcome_m_' || c."id", c."id",
       COALESCE((SELECT MIN(m."order") FROM "CourseModule" m WHERE m."courseId" = c."id"), 1) - 1,
       'Welcome', NULL, false, 'PUBLISHED', NOW(), NOW()
FROM "AcademyCourse" c
WHERE c."introVideoUrl" IS NOT NULL AND btrim(c."introVideoUrl") <> ''
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CourseLesson" ("id", "moduleId", "order", "title", "contentType", "url", "isRequired", "status", "isFreePreview", "requiredPercent", "createdAt", "updatedAt")
SELECT 'welcome_l_' || c."id", 'welcome_m_' || c."id", 1, 'Welcome to the course', 'VIDEO', btrim(c."introVideoUrl"), false, 'PUBLISHED', true, 90, NOW(), NOW()
FROM "AcademyCourse" c
WHERE c."introVideoUrl" IS NOT NULL AND btrim(c."introVideoUrl") <> ''
ON CONFLICT ("id") DO NOTHING;
