# Agency platform v2: inspection report and Phase 1 plan

Spec: "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" (received 2026-10-14). It extends the multi-agency marketplace and supersedes parts of the earlier A1 to A6 spec. This document is step 1 (inspect and report) and step 2 (Phase 1 plan). Nothing here is implemented yet.

## 1. What exists today

| Area | Current state | Gap against the spec |
| --- | --- | --- |
| Agent and profile model | `User` (login, email, role) 1:1 `AgentProfile` (`userId @unique`; `displayName` is a free professional name up to 60 chars; status ladder DRAFT to APPROVED, HIDDEN, SUSPENDED). `AgentPrivateContact` holds legal name, personal email, phone, address, resume key, government ID refs behind `agent.read_private_contact`. | No PlatformIdentity. No talent type. One profile per user forever. Duplicate detection is only the unique email on `User`. Phone exists only in the private contact row. |
| Agency membership (A1) | `Agency` with real identity fields (name, logo, contact email and phone, website, country, city), `planId` placeholder, status ACTIVE / SUSPENDED / INACTIVE. `AgencyUser` = Owner and Manager portal seats. `AgencyMembership {agentProfileId, agencyId?, isPrimary, status ACTIVE / ENDED, joinedAt, leftAt, approvedById, endReason}`; `AgentProfile.primaryAgencyId`. One active membership is enforced in the service only. | No invite links, no Agent Seats, no plans or seat packages, no exit or removal flows, no client-facing code or name, no DB constraint for one active membership. Only an Admin override moves an agent between agencies. |
| Agreements | `Agreement {type (14 values), version, title, bodyMarkdown, bodyChecksum, effectiveFrom, isActive, requiredForRole}`; `AgreementAcceptance {agreementId, userId, acceptedAt, ipAddress, userAgent, bodyChecksum, placementId, context, applicationId, submissionId}`. The gate in `require-actor.ts` sends users with missing active agreements to `/agreements`, where they accept each one (6 for talent, 5 for clients). Agency applicants accept `AGENCY_NON_CIRCUMVENTION` inside the application (A1). `PLACEMENT_SERVICE_AGREEMENT` is accepted per placement. Admin can publish new versions (launch prep). | No single document, no sections, no material / non-material flag, no privacy mode, no acceptance at signup (registration forms have no checkbox), no role or agency on the acceptance, no acceptance report or export. |
| Course seats | None. Only the permission keys `agency.training.purchase` and `agency.training.assign` exist as A3 placeholders. `CourseEnrollment` has `source INTERNAL / ACADEMY_SYNC`, payment status, price snapshot. | Nothing to distinguish from Agent Seats yet. No sponsoring agency, no REVOKED enrollment status. |
| Certifications and assessments | `Certification {origin ACADEMY / ADMIN_ISSUED, status PENDING_REVIEW / APPROVED / REVOKED / EXPIRED, revokedReason, courseId, assessmentId}` with `revokeCertification`. The verification ladder counts APPROVED certifications. `Assessment {status DRAFT / SUBMITTED / FINAL}` is coach-authored. | No source or sponsoring agency on either. No "inactive for platform use" or "historical" states. Eligibility (verification ladder) does not know about sources. |
| Client-facing serializers | Allow-list projections exist: `toCandidateClientView`, `toCandidateCardView`, `toRequestClientView`, `toPlacementView("CLIENT")`, with `FORBIDDEN_FOR_CLIENT` key tests. | Clients see nothing about agencies yet because opportunities and submissions (A4, A5) are not built. See the leak list below for agent data. |
| Messaging | `InterviewMessage` threads per interview request, always mediated by Hirewise. `scanMessage` in `src/lib/message-filter.ts` detects contact details and rate talk; contact details hold the message for Sales review and raise an `ActivityFlag`. | Hold-only, no masking mode. No threads outside interview requests, no agency participants, no email aliases. |
| Interview scheduling | `InterviewRequest` (Sales proposes slots, client confirms, candidates respond) and `Interview` rows with a meeting link from the `meetings` adapter (none / fake / Zoom) or pasted by Sales. Agents learn the company name from SCHEDULED onward. | Already Hirewise-coordinated. Pasted links are not restricted to Hirewise-owned providers. The spec wants masked client labels until a disclosure grant, which conflicts with the current reveal at scheduling. |
| Document storage | `Document {ownerType, ownerId, kind, storageKey, visibility}`; storage adapter (local, S3, R2) with signed URLs; resume on the private contact row; videos, recordings, portfolio items gated by APPROVED. | No sanitized copies, no sanitization status, no review queue beyond media approval. |
| Bypass handling | `Incident {type OFF_PLATFORM_CONTACT / DIRECT_HIRE_ATTEMPT / ..., severity, status OPEN / UNDER_REVIEW / RESOLVED / DISMISSED, evidenceDocumentIds}` created by staff from flags and held messages. | No reporting entry point for clients, owners, or agents; no Warning / Restricted / Suspended outcomes tied to permissions. BypassReport should extend `Incident` rather than duplicate it. |
| Duplicate and identity review | None. | New. |

### Pieces the spec treats as existing that are not built

The earlier marketplace spec is complete only through A1. The following do not exist and will have to be built inside the phases that need them:

- Agent invite and join flows (old A2). Needed by new Phase 2.
- Training marketplace, course seats, agency-sponsored enrollments (old A3). Needed by new Phase 2 (course seats vs agent seats) and Phase 4 (credential sources).
- Opportunities, agency eligibility, submissions, submission review (old A4, A5). Needed by new Phases 3 to 6 (pending submissions withdrawn on exit, submission eligibility, client-facing Partner Teams, interview requests from opportunities).
- Agency reporting (old A6). Needed by new Phase 6 dashboards.

Each new phase will carry the minimum of these foundations it needs. Phase 2 and Phase 5 will be the largest as a result.

### Where real agency or agent contact data could reach a client today

1. `AgentProfile.displayName` is agent-chosen and often a full name. It appears on candidate cards, profiles, interview requests, placements, and the public certificate verification page.
2. `Portfolio.url` is passed to clients unchanged. A personal site or LinkedIn URL leaks identity and contact routes.
3. Free text reaches clients: `summary`, `headline`, `Experience.description`, portfolio descriptions, client-visible coach evaluation text. The `CONTACT_INFO_IN_PROFILE` rule flags profile text for review but does not block it.
4. `Interview.meetingLink` is shown to clients and agents. When Sales pastes a link it can be any provider, including an agency's own.
5. Email notifications to clients include the agent's display name; none include contact details.
6. Client data toward agents: `companyName` is revealed to candidates from SCHEDULED (Section 6 footnote 9). The spec wants masked labels until a disclosure grant. Decision needed (see 3.f).
7. `GET /api/export/client` must be re-checked against the new allow-lists in Phase 5.

No agency identity reaches clients today because clients cannot see agencies at all.

## 2. Phase 1 plan: Identity and Terms

### 2.1 Schema (one additive migration plus a deterministic data backfill)

New models

- `PlatformIdentity {id, userId @unique, status ACTIVE / MERGED / BLOCKED, primaryEmail (citext), verifiedAt?, idVerificationRefs Json? (encrypted-at-rest refs only), duplicateKeys String[] (normalized email and phone hashes), notes (Hirewise only), createdAt, updatedAt}`. One per talent-type user (agents, applicants, future independents). Clients and staff do not get one in Phase 1.
- `PlatformIdentityContact {id, identityId, kind EMAIL / PHONE, valueNormalized, valueDisplay, verifiedAt?, source SIGNUP / PRIVATE_CONTACT / ADMIN, createdAt}` with an index on `(kind, valueNormalized)`. Not unique: duplicates are flags, not errors.
- `DuplicateFlag {id, kind SIGNUP / AGENCY_APPLICATION / INVITE_JOIN / INDEPENDENT_REAPPLY, attemptedEmail, attemptedPhone?, attemptedName, attemptedData Json (never a password), matchedIdentityId?, matchedUserId?, matchReasons String[] (EMAIL, PHONE, IDENTITY, ACTIVE_MEMBERSHIP, INDEPENDENT_PROFILE), status OPEN / APPROVED_NEW_PROFILE / LINKED / REJECTED, reviewedById?, reviewedAt?, decisionNote?, continuationTokenId?, createdAt}`.

Extended models

- `AgentProfile` is the spec's TalentProfile; the table keeps its name to avoid touching several hundred references. It gains `platformIdentityId` (required after backfill), `talentType HIREWISE_DIRECT / AGENCY_AGENT / INDEPENDENT_FREELANCER`, `archivedAt?`; `AgentProfileStatus` gains `FORMER_AGENCY_AGENT` and `ARCHIVED`. `userId` loses `@unique`; the migration adds two partial unique indexes in SQL: one non-archived profile per user, and one non-archived profile per `platformIdentityId`.
- `Agreement`: `sections Json` (ordered `{key, title, audiences[], bodyMarkdown}`), `isMaterialChange`, `requiresReacceptance`, `privacyPolicyMode COMBINED / SEPARATE`, `publishedById?`, `publishedAt?`, `supersedesId?`, `requiredForRoles RoleKey[]` for the unified document (`requiredForRole` stays for transactional agreements).
- `AgreementType` gains `PLATFORM_TERMS` and `PRIVACY_POLICY`.
- `AgreementAcceptance`: `role RoleKey`, `agencyId?`; `context` gains SIGNUP, INDEPENDENT_REAPPLICATION, REACCEPTANCE; `ipAddress` and `userAgent` stay (INV-I2).
- Settings: `identity {rejoinCreatesFreshProfile: true, duplicateCheckPhone: true, notifyExistingOnDuplicate: true}` and `terms {privacyPolicyMode: "COMBINED", gateStaff: false}`.

Backfill (inside the migration, idempotent, no deletes)

- One `PlatformIdentity` per existing `AgentProfile` and per `APPLICANT` user; contacts from `User.email` and `AgentPrivateContact.phone` and `personalEmail`, normalized.
- `talentType` = AGENCY_AGENT when `primaryAgencyId` is set, otherwise HIREWISE_DIRECT.
- Unified terms v1 and privacy policy v1 inserted with PLACEHOLDER sections and a checksum, so production receives them through `migrate deploy` alone. The seed script stays idempotent but is no longer required for this.
- The eleven separate client and talent agreements and `SUBMISSION_TERMS` are set `isActive = false`; history and acceptances are untouched. `AGENCY_NON_CIRCUMVENTION` is deactivated and the agency application records a contextual acceptance of the unified terms instead. `PLACEMENT_SERVICE_AGREEMENT` stays active (see 3.c).

### 2.2 Server

- `identity.service.ts`: `ensureIdentityForUser`, `normalizeEmail` and `normalizePhone`, `detectDuplicates(input)` returning match reasons, `raiseDuplicateFlag`, `listDuplicateFlags`, `decideDuplicateFlag` (APPROVE_NEW_PROFILE emails a one-time continuation link so the person finishes signup without the check; LINKED emails the existing address a sign-in reminder; REJECTED closes), `identityForStaff` with full history (profiles, memberships, acceptances, flags), `activeProfileFor(identity)`.
- `terms.service.ts`: `currentTerms(role)`, `sectionsFor(role)`, `acceptTerms(actor or signup, context, meta)` writing one acceptance row per document (terms, plus privacy when combined), `reacceptanceRequired(actor)`, `publishTermsVersion` (Admin: sections, material flag, requires reacceptance), `acceptanceReport(filters)` and CSV through the existing export service.
- `auth.service.ts`, `agent.service.ts`, `agency-application.service.ts`: registration paths require `termsAccepted`, run duplicate detection first, create the identity, and record the SIGNUP acceptance in the same transaction. On a duplicate match: no account, the generic "Existing Hirewise Connect membership detected" message, a flag, and an optional email to the existing address.
- `require-actor.ts`: the agreements gate becomes "unified terms current for this role" plus any transactional agreement already pending; staff are not gated unless `terms.gateStaff` is on.
- `resolve-actor.ts`: `agentProfileId` resolves to the active profile; `Actor` gains `identityId`.
- State: `src/server/state/duplicate-flag.ts`. Views: `identity.views.ts` (staff only), `terms.views.ts` (the public document view carries no user data). `FORBIDDEN_FOR_CLIENT` gains `platformIdentity`, `platformIdentityId`, `identityContacts`, `duplicateKeys`, `idVerificationRefs`; a new `FORBIDDEN_FOR_AGENCY` list starts here.
- Audit: `IDENTITY_CREATED`, `IDENTITY_CONTACT_ADDED`, `DUPLICATE_FLAG_RAISED`, `DUPLICATE_FLAG_DECIDED`, `TERMS_PUBLISHED`, `TERMS_ACCEPTED`. Events: `DUPLICATE_FLAG_RAISED` (Admin task), `TERMS_VERSION_PUBLISHED` (notify affected roles when material).
- Permissions: `identity.read` and `identity.review` (Admin, Super Admin), `terms.manage` (Super Admin, grantable to Admin), `terms.report` (Admin, Super Admin).

### 2.3 UI

- Signup forms (talent, client, "I run a team"): one checkbox with the configured label; "View Full Terms" opens an in-page drawer (table of contents, expandable sections, search, role-relevant sections highlighted) so the form keeps its state. Public `/terms` and `/privacy` pages render the current versions.
- The `/agreements` gate becomes one reacceptance screen with the same checkbox and a "what changed" summary from the version notes; transactional agreements keep their own step when pending.
- Staff → Identity: the duplicate flag queue with match reasons and the three decisions; identity detail with full history. Staff → Settings → Terms: versions, section editor, material and reacceptance flags, publish, acceptance status per user, role, and agency, CSV export.
- Account page: accepted terms version and date.

### 2.4 Tests

- Migration backfill against the seed dataset: every profile has an identity, contacts are normalized, talent types are correct, old agreements inactive, unified terms active.
- DB constraints: a second non-archived profile per user or per identity is rejected by Postgres; archived profiles are allowed.
- Duplicate detection matrix: email exact, email case and whitespace variants, phone formats, no match; each registration path (talent, client, applicant) raises a flag instead of creating an account; the three decisions and the continuation token; the existing-address email.
- Acceptance rows carry user, role, agency, version, timestamp, context, checksum; signup records them in the same transaction as the account.
- Reacceptance: a material version with `requiresReacceptance` forces one checkbox on next login; a non-material one does not; privacy mode changes the label and the recorded rows.
- Projection tests for the new forbidden keys; Forbidden tests per role for identity and terms admin functions.

### 2.5 Out of Phase 1

Seats, invite links, exit flows, credential sources, independent reapplication, client-facing identities, sanitized documents, messaging changes, bypass reporting. The identity split only prepares them.

## 3. Decisions needed before implementation

- a. **Rejoin behaviour (the spec asks for confirmation).** Joining a different agency later creates a new fresh profile. Setting `identity.rejoinCreatesFreshProfile`, default true, also applies to returning to the same agency. Confirm or change the default.
- b. **Staff and the unified terms.** Default: staff accounts are not gated by the terms (setting `terms.gateStaff` off). Gating staff risks locking the admin out on deploy.
- c. **Placement Service Agreement stays per placement.** It is a contract for a specific engagement, not platform terms, so it keeps its own acceptance step. `SUBMISSION_TERMS` is retired; a later setting lets Admin flag high-risk submission types.
- d. **Existing users reaccept once.** Everyone on production (the admin account and the current sign-ups) sees the single checkbox once on next login because the unified document is new. Old acceptances stay as history.
- e. **IP and user agent stay on acceptances.** INV-I2 in MASTER_PROMPT Section 1 overrides the spec's "only if legally appropriate"; the configurable part is display and export, not recording.
- f. **Client company name toward agents.** Today agents see the company from SCHEDULED. The spec wants masked labels until a disclosure grant. Default for Phase 5: keep the reveal at scheduling for Hirewise Direct talent and mask for agency submissions. Confirm, or choose one rule for everyone.
- g. **Duplicate message and enumeration.** The "Existing membership detected" message confirms that an email or phone is known. Default: show it (the spec requires it) and email the existing address, with no other detail on screen.
- h. **Production seed still unconfirmed.** Phase 1's migration carries its own data, so it does not depend on the seed script, but the A1 roles and agreements still need the seed to have run before agency signup works on production.
