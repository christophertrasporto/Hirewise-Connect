-- Skills system, data step. Idempotent.
-- Every existing skill becomes a tag with a slug ("cold-calling") and a hashtag ("#ColdCalling"); verification mode starts at NONE.
UPDATE "Skill" SET "slug" = lower(regexp_replace(regexp_replace(btrim("name"), '[^A-Za-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
WHERE "slug" IS NULL;

UPDATE "Skill" SET "hashtag" = '#' || regexp_replace(initcap(regexp_replace(btrim("name"), '[^A-Za-z0-9]+', ' ', 'g')), '\s+', '', 'g')
WHERE "hashtag" IS NULL;
