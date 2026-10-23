# Skills system: plan for the two-tier model (Skill Tags and Verified Skills)

Source: "Hirewise Connect — Skills System Data Model & Migration Spec" (received 2026-10-23). The spec is written for Laravel and Eloquent; this plan translates it onto the existing Next.js, Prisma, and Postgres codebase, reusing the tables that already exist instead of creating parallel ones. Nothing here is implemented yet.

## 1. What exists and how the spec maps onto it

| Spec table | Here today | Plan |
| --- | --- | --- |
| `skill_tags` | `Skill {name, category, isActive}` (seeded list, curated) | Extend `Skill` with `slug`, `hashtag`, `description`, `verificationMode NONE / ANY_COURSE / REQUIRED_COURSE / PATHWAY`, `requiredCourseId`, `requiredPathwayId`, `minAssessmentScore` (default 80). The seeded skills become the initial tag list. |
| `user_skill_tag` | `AgentSkill {agentProfileId, skillId, level, yearsUsed, verifiedById}` | Reshape: drop `level`, `yearsUsed`, and the manual `verifiedById`; add `verifiedAt` (cached, written only by the verification service) and `verifiedVia` (the course or pathway that satisfied it, for the badge tooltip). Existing rows survive as declared tags; years and level are discarded per the spec. |
| `courses` | `AcademyCourse` (passing score, certification template, published state) | Reused as is. |
| `course_skill_tag` | none | New `CourseSkillTag {courseId, skillId}`; edited in the course builder. |
| `skill_pathways`, `pathway_courses` | `CoursePrerequisite` only | New `SkillPathway {title, slug, description, isActive}` and `PathwayCourse {pathwayId, courseId, sortOrder, isRequired}`. |
| `user_course_completions` | `CourseEnrollment` + `CourseCompletion {completedAt, examScore}` with the phase 4 source and revocation fields | Reused. "Passed" = a completion whose `examScore` is at least the tag's `minAssessmentScore` (or any completion when the course has no exam), on an enrollment that is not `REVOKED`. |
| `certifications`, `user_certifications` | `CertificationTemplate`, `Certification` (status, expiry, source, verification code) | Reused; `CertificationTemplate` gains `skillId` (the tag it validates). |
| `client_opportunities`, `opportunity_requirements` | `Opportunity` (phase 6b) with `ClientRequirement.skills` as free text or ids | New `OpportunityRequirement {opportunityId, skillId?, certificationTemplateId?, requiredLevel DECLARED / VERIFIED / CERTIFIED}`; the publish form turns the requirement's skills into DECLARED rows that staff can raise to VERIFIED or CERTIFIED. |
| `SkillVerificationService` | `verification.service.ts` (the profile ladder) | New `skill-verification.service.ts`: the only writer of `verifiedAt`. The ladder is untouched. |
| Tag request / moderation (open decision 1) | none | New `SkillTagRequest {text, requestedById, status, decidedById, mergedIntoSkillId}` with a staff queue under Staff, Academy. |

Five tables beyond MASTER_PROMPT.md sections 4 to 7 are proposed with these reasons: `CourseSkillTag` (course to tag mapping), `SkillPathway` and `PathwayCourse` (spec section 9), `OpportunityRequirement` (spec section 15, replaces free-text skills on opportunities), `SkillTagRequest` (spec open decision 1, curated list with requests).

## 2. Where the old fields are used today

`AgentSkill.level` and `yearsUsed` appear in the skills form and schema, the agent self view, the candidate client and card views, the staff talent page, the client candidate page, and search (skill ids only, no level). Matching compares skill names only. Nothing scores by level or years, so dropping them changes display, not ranking. `SoftwareExperience.level` is not mentioned by the spec and stays (decision 5).

## 3. Verification rules (spec section 5), as implemented here

- `recomputeSkillVerification(db, agentProfileId)` loads the agent's declared tags and, per tag, evaluates the mode: NONE never; REQUIRED_COURSE a passing, non-revoked completion of that course; PATHWAY passing, non-revoked completions of every required course in the pathway; ANY_COURSE a passing, non-revoked completion of any course mapped to the tag. `verifiedAt` is kept when already set and the rule still holds, set to now when newly satisfied, cleared when no longer satisfied.
- Triggers: course completion (`recalculateCourseProgress`), certification approval, revocation, or expiry when the template names a tag, the phase 4 exit revocation (`revokeAgencySponsoredOnExit`), course to tag mapping changes and tag configuration changes (recompute for everyone holding the tag, in the worker), and the maintenance pass as a safety net.
- No user action and no staff form writes `verifiedAt`. The skills form only adds and removes declared tags. Staff configure how a tag is verified; they do not verify agents.

## 4. Surfaces

- Agent profile, Skills: a curated hashtag picker with search, "Request a tag" (goes to the staff queue), two sections "Your skill tags" and "Verified by Hirewise" with the check badge, the legend, the disclaimer text from the spec, and for each unverified tag a "Want to verify this skill?" link to the mapped courses (spec section 12).
- Candidate views (client card and profile, staff page): tags as hashtags, verified ones with the badge and the verifying course or pathway, certifications unchanged. Phase 5 rules apply unchanged; tags are curated labels, so no redaction is needed.
- Search: tag filters gain a "Verified only" switch (index on `skillId, verifiedAt`); the certification filter already exists.
- Staff, Academy: Skill tags (slug, hashtag, verification mode, required course or pathway, minimum score, active), Pathways (courses in order, required flags), Tag requests (approve into a new tag, merge into an existing one, reject). Course builder: the tags a course supports. Permissions: `skills.manage` for tags, pathways, and requests; `course.manage` or `course.create_own` with ownership for a course's tags.
- Opportunities: the publish form lists the requirement's skills as DECLARED requirements that staff can raise; the agency Opportunities page shows per member which requirements they meet; `submitAgent` and the client's candidate list enforce them (spec section 7: all requirements must pass). Agency owners get a link to Training for members who miss a VERIFIED requirement (spec section 14 "Assign Training" already exists as Course Seats).
- Matching: VERIFIED and CERTIFIED requirements become hard rules in `scoreCandidate`; DECLARED stays the current soft skills rule.

## 5. Migration

One schema migration plus a data step, after the user takes a production backup (spec section 3.1; I do not run backups):

1. Add the new columns and tables.
2. Backfill `Skill.slug` and `hashtag` from the name ("Cold Calling" becomes `cold-calling` and `#ColdCalling`); every existing skill starts with `verificationMode NONE` until staff configure it.
3. Drop `AgentSkill.level`, `AgentSkill.yearsUsed`, `AgentSkill.verifiedById`, and the `SkillLevel` enum's use on `AgentSkill` (`SoftwareExperience` keeps it).
4. Recompute verification for every agent in the worker's first maintenance pass after deploy (all tags are NONE at that point, so nothing is verified until staff configure modes).

The seed script gains slugs and hashtags for the seeded skills.

## 6. Tests

Derived verification per mode including the minimum score, non-revoked completions only, and pathway required flags; the only-writer rule (profile updates and staff forms never set `verifiedAt`; a direct attempt through the skills form is ignored); clearing on exit revocation, certification revocation, and expiry; recompute on mapping and configuration changes; search "Verified only"; opportunity requirements at each level in `submitAgent` and the client list; tag requests and merges; forbidden keys on the new view fields; the existing skills tests updated for the dropped fields.

## 7. Decisions to confirm

1. **Tag creation policy**: curated list plus "Request a tag" with a staff queue (the spec's recommendation). Agents cannot create tags directly.
2. **Certification expiry or revocation clears verification** of the linked tag; the existing expiry job triggers the recompute.
3. **ANY_COURSE means any one course**; a `minCoursesRequired` column is left out until asked.
4. **Agency-sponsored completions revoked at exit stop counting**, so a verified tag that depended on them is cleared, consistent with phase 4 (revoked credentials never satisfy eligibility).
5. **Software levels stay** as they are; the spec covers skills only.
6. **"Passed" uses the course exam score** when the course has an exam, else completion alone; the tag's minimum score defaults to 80 as in the spec.
7. **Old level and years data is discarded** (dropped columns, no archive), exactly as the spec decides; declared tags themselves carry over. You take the production backup before the migration runs.
8. **Opportunity requirements default to DECLARED** from the requirement's skills; staff raise them to VERIFIED or CERTIFIED per opportunity. VERIFIED and CERTIFIED are hard matching rules.
9. **Permissions**: no new keys; `skills.manage` covers tags, pathways, and requests, and course ownership covers a course's tag mapping.
10. **Scope**: one phase, one pull request, then the production migration as usual. The spec's later artifacts (PRD, mockups) are covered by this plan and the walkthrough that follows the build.
