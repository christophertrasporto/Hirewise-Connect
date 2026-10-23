# Skills system: Skill Tags and Verified Skills

Built from `docs/plan-skills-tags.md` (approved decisions 1 to 10) and the "Hirewise Connect — Skills System Data Model & Migration Spec" of 2026-10-23. Skills are now two tiers: a **skill tag** is a curated hashtag that talent declares about themselves and clients can search, and **Verified by Hirewise** is a badge the platform derives from completed Hirewise training. Nobody sets the badge by hand.

## What changed

| Area | Delivered |
| --- | --- |
| Tags | `Skill` gained `slug` (unique), `hashtag`, `description`, `verificationMode` (`NONE`, `ANY_COURSE`, `REQUIRED_COURSE`, `PATHWAY`), `requiredCourseId`, `requiredPathwayId`, and `minAssessmentScore` (default 80). The seeded skills are the initial list; the data migration backfilled slugs and hashtags ("Cold Calling" is `cold-calling` and `#ColdCalling`). Staff with `skills.manage` curate tags under Staff, Academy, Skill tags. |
| Declared tags | `AgentSkill` is now `{agentProfileId, skillId, verifiedAt, verifiedVia}`. `level`, `yearsUsed`, and the manual `verifiedById` were dropped (decision 7). The profile Skills page is a hashtag picker (at least three tags, search, request a tag) with two cards: Verified by Hirewise and Your skill tags, each unverified tag linking to the course that verifies it. Software levels are unchanged (decision 5). |
| Verification | `skill-verification.service.ts` is the only writer of `verifiedAt`. Per declared tag: `REQUIRED_COURSE` needs a passing completion of that course, `PATHWAY` needs every required course of the pathway, `ANY_COURSE` needs any course mapped through `CourseSkillTag`, `NONE` never verifies. "Passing" is a non-revoked enrollment with a completion whose exam score is at least the tag's minimum, or any completion when the course has no exam (decision 6). A certification template may name the tag it validates; a revoked, expired, or deactivated certification of that template clears the badge until a new one is approved (decision 2). Agency-sponsored completions revoked at exit stop counting (decision 4). |
| Triggers | Course completion (`recalculateCourseProgress`), certification issue, review, revoke, and expiry, the exit revocation, course tag mapping changes, tag and pathway configuration changes (every holder is re-evaluated), profile skill saves, and the worker's maintenance pass as a safety net. |
| Courses and pathways | Coaches map the tags a course verifies from the course builder's Certification tab (course ownership, not `skills.manage`). `SkillPathway` and `PathwayCourse` (ordered, required flag) are managed on the Skill tags page. |
| Tag requests | Talent request a missing tag from the Skills page (`SkillTagRequest`). Staff approve (the tag is created and added to the requester), merge into an existing tag (added to the requester), or reject with a note. Both sides are notified (`SKILL_TAG_REQUESTED`, `SKILL_TAG_REQUEST_DECIDED`). Decision 1. |
| Opportunities | Publishing seeds `OpportunityRequirement` rows at `DECLARED` from the requirement's skills. Staff with `opportunity.manage` raise a tag to `VERIFIED` or add a `CERTIFIED` certification on the opportunity page. `submitAgent` refuses a candidate who misses any requirement; the agency Opportunities page lists the reason per member; `matchCandidates` treats `VERIFIED` and `CERTIFIED` as hard rules once the requirement is published (decision 8). |
| Search | The talent search has "Only skills Verified by Hirewise" (`verifiedOnly`), backed by the `(skillId, verifiedAt)` index. |
| Views | Self view: `{skillId, name, hashtag, category, verified, verifiedAt, verifiedVia, verifiable}`. Client profile: `{name, hashtag, category, verified}`. Cards: `{name, hashtag, verified}` and `verifiedSkillCount`. Clients never receive `verifiedVia` or `verifiedAt`. |
| Permissions | None added (decision 9): `skills.manage` covers tags, pathways, and requests; course ownership covers a course's mapping; `opportunity.manage` covers requirements; `verification.manage` covers the certification template link. |

## Where the rules are enforced

- `skillsRepository.setVerification` is the only write to `verifiedAt`, and only `recomputeSkillVerification` calls it. `updateSkills` and `replaceDeclaredTags` keep existing rows, so a surviving badge is not lost when the agent re-saves their tags.
- `saveSkillTag`, `savePathway`, `listTagRequests`, and `decideTagRequest` authorize `skills.manage`; `setCourseSkillTags` uses `assertCoachAssigned` (a coach not on the course gets NotFound); `requestSkillTag` is AGENT only; `setOpportunityRequirements` authorizes `opportunity.manage`.
- `unmetRequirements` is the single evaluator used by `submitAgent`, `listOpportunitiesForAgency`, and the tests; matching re-implements only the hard levels on top of its own candidate rows.

## Migration

`20261023090000_skill_tags_schema` (new columns, enums, and tables; drops `AgentSkill.level`, `yearsUsed`, `verifiedById`) and `20261023090001_skill_tags_data` (slug and hashtag backfill). The column drop is destructive: take the production backup first (plan section 5), then `npm run db:deploy`. Every tag starts at `NONE`, so nothing is verified until staff configure modes; the first maintenance pass recomputes once they do.

## Tests

`tests/integration/skills.test.ts` (16 tests): slug and hashtag derivation, duplicate and role checks on tags; verification modes, the score threshold, no-exam completion, mapping and configuration changes, pathways with required flags, access revocation, the certification link, exit revocation, and the maintenance pass; tag requests through approve, merge, and reject with notifications; opportunity requirements seeded at publish, raised to verified, blocking submission until the badge is derived, the client view leak sweep; search `verifiedOnly`, card and profile shapes; matching hard rules. Existing views and marketplace tests were updated for the dropped fields.

## Next

Staff configure verification modes for the seeded tags and map courses in the builder; the Verified badge then appears as learners complete those courses.
