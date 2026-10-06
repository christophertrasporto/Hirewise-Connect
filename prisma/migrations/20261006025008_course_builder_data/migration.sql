-- ---------------------------------------------------------------------------
-- Data migration (course builder phase 1). Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Categories: the standard set plus every category string courses already use.
INSERT INTO "CourseCategory" ("id", "name", "slug", "order", "isActive", "createdAt", "updatedAt")
SELECT 'cat_' || md5(v.name), v.name, v.slug, v.ord, true, NOW(), NOW()
FROM (VALUES
  ('Foundation', 'foundation', 10),
  ('Virtual Assistant', 'virtual-assistant', 20),
  ('Cold Calling', 'cold-calling', 30),
  ('Appointment Setting', 'appointment-setting', 40),
  ('Sales', 'sales', 50),
  ('Customer Service', 'customer-service', 60),
  ('Leadership', 'leadership', 70),
  ('Management', 'management', 80),
  ('Agency Building', 'agency-building', 90),
  ('AI & Automation', 'ai-automation', 100),
  ('Marketing', 'marketing', 110),
  ('Specialized Skills', 'specialized-skills', 120)
) AS v(name, slug, ord)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "CourseCategory" ("id", "name", "slug", "order", "isActive", "createdAt", "updatedAt")
SELECT 'cat_' || md5(c."category"), c."category",
       regexp_replace(lower(trim(c."category")), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5(c."category"), 1, 4),
       1000, true, NOW(), NOW()
FROM (SELECT DISTINCT "category" FROM "AcademyCourse" WHERE "category" <> '') c
ON CONFLICT ("name") DO NOTHING;

UPDATE "AcademyCourse" ac
SET "categoryId" = cc."id"
FROM "CourseCategory" cc
WHERE ac."categoryId" IS NULL AND cc."name" = ac."category";

-- 2. Existing per-course exams become a QUIZ lesson in a "Final exam" module. Ids are reused
--    (lesson = exam id, question = exam question id, attempt = exam attempt id) so nothing has to be remapped.
INSERT INTO "CourseModule" ("id", "courseId", "order", "title", "description", "isRequired", "status", "createdAt", "updatedAt")
SELECT 'mod_final_' || e."courseId", e."courseId",
       COALESCE((SELECT MAX("order") FROM "CourseModule" m WHERE m."courseId" = e."courseId"), 0) + 1,
       'Final exam', NULL, true, 'PUBLISHED', e."createdAt", NOW()
FROM "Exam" e
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CourseLesson" ("id", "moduleId", "order", "title", "contentType", "body", "isRequired", "status", "version",
                            "passingScore", "maxAttempts", "timeLimitMin", "scorePolicy", "reviewMode", "createdAt", "updatedAt")
SELECT e."id", 'mod_final_' || e."courseId", 1, e."title", 'QUIZ', e."instructions", true,
       CASE WHEN e."status" = 'PUBLISHED' THEN 'PUBLISHED'::"PublishState" ELSE 'DRAFT'::"PublishState" END,
       1, c."passingScore", e."maxAttempts", e."timeLimitMin", 'HIGHEST', 'AUTO', e."createdAt", NOW()
FROM "Exam" e JOIN "AcademyCourse" c ON c."id" = e."courseId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Question" ("id", "lessonId", "courseId", "type", "prompt", "explanation", "points", "isRequired", "order", "state", "version", "keywords", "source", "createdAt", "updatedAt")
SELECT q."id", q."examId", e."courseId", 'MULTIPLE_CHOICE', q."prompt", q."explanation", q."points", true, q."order", 'PUBLISHED', 1, '{}', 'coach', e."createdAt", NOW()
FROM "ExamQuestion" q JOIN "Exam" e ON e."id" = q."examId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "QuestionChoice" ("id", "questionId", "text", "isCorrect", "order")
SELECT q."id" || '-' || (o.idx - 1), q."id", o.text, (o.idx - 1) = q."correctIndex", (o.idx - 1)::int
FROM "ExamQuestion" q, unnest(q."options") WITH ORDINALITY AS o(text, idx)
ON CONFLICT ("id") DO NOTHING;

-- Attempts: snapshot the questions as they were, and map "questionId -> option index" answers to choice ids.
INSERT INTO "QuizAttempt" ("id", "lessonId", "agentProfileId", "lessonVersion", "status", "questionSnapshot", "answers", "scorePercent", "passed", "startedAt", "submittedAt", "expiresAt")
SELECT a."id", a."examId", en."agentProfileId", 1,
       CASE a."status" WHEN 'SUBMITTED' THEN 'SUBMITTED'::"QuizAttemptStatus" WHEN 'EXPIRED' THEN 'EXPIRED'::"QuizAttemptStatus" ELSE 'IN_PROGRESS'::"QuizAttemptStatus" END,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('questionId', q."id", 'version', 1, 'points', q."points",
                  'choiceIds', (SELECT jsonb_agg(ch."id" ORDER BY ch."order") FROM "QuestionChoice" ch WHERE ch."questionId" = q."id")) ORDER BY q."order")
         FROM "Question" q WHERE q."lessonId" = a."examId"
       ), '[]'::jsonb),
       (SELECT jsonb_object_agg(kv.key, jsonb_build_array(kv.key || '-' || kv.value))
        FROM jsonb_each_text(COALESCE(a."answers", '{}'::jsonb)) kv
        WHERE kv.value ~ '^[0-9]+$'),
       a."scorePercent", a."passed", a."startedAt", a."submittedAt", a."expiresAt"
FROM "ExamAttempt" a JOIN "CourseEnrollment" en ON en."id" = a."enrollmentId"
ON CONFLICT ("id") DO NOTHING;

-- 3. Default media completion share for existing audio and video lessons.
UPDATE "CourseLesson" SET "requiredPercent" = 90 WHERE "contentType" IN ('AUDIO', 'VIDEO') AND "requiredPercent" IS NULL;
