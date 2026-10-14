# Agency platform v2, phase 1: Platform Identity and unified Terms

The first of six phases from the "Agent Seats, exclusivity, Platform Identity, client protection, unified Terms" spec (see `docs/plan-agency-identity-phase1.md` for the inspection report and the approved decisions). Phase 1 gives every talent-type account a permanent, Hirewise-only identity, turns duplicate sign-ups into a review queue instead of accounts, and replaces the twelve per-role agreements with one Terms & Platform Agreement accepted with a single checkbox.

## What changed

| Area | Before | After |
| --- | --- | --- |
| Identity | One `User` to one `AgentProfile`, duplicate detection = unique email | `PlatformIdentity` (one per talent-type user, Hirewise only) with normalised `PlatformIdentityContact` rows (email, phone). `AgentProfile` is the spec's TalentProfile: `platformIdentityId`, `talentType`, `archivedAt`, statuses `FORMER_AGENCY_AGENT` and `ARCHIVED`. Two partial unique indexes enforce one non-archived profile per user and per identity. |
| Duplicate sign-ups | "Email already in use" | Email and phone variants are matched against users and identity contacts. A match raises a `DuplicateFlag` (kind, attempted details without the password, matched identity, reasons) and shows the generic "Existing Hirewise Connect membership detected" message. No account is created. Admins decide under Staff → Identity: approve new profile (emails a one-time continuation link that skips detection once), link (emails the existing address a sign-in reminder), or reject. The existing address is warned on a match when `identity.notifyExistingOnDuplicate` is on. |
| Agreements | Six talent and five client documents accepted one by one after email verification, plus an agency policy at application | One `PLATFORM_TERMS` document (21 placeholder sections across five audiences) and one `PRIVACY_POLICY`. One checkbox at sign-up records both (user, role, agency, version, checksum, time, context, IP, user agent). Material versions with `requiresReacceptance` re-gate everyone in the required roles once; non-material versions do not. The twelve per-role documents and `SUBMISSION_TERMS` are inactive history; `PLACEMENT_SERVICE_AGREEMENT` keeps its per-placement step. The agency application records a second, contextual acceptance of the same document. |
| Admin | Agreement text editor per type | Staff → Agreements: section editor for the unified documents (audiences, material flag, re-acceptance, privacy mode, change note), acceptance report per user, role, and agency with CSV export (`/api/reports/terms-acceptances`). Staff → Identity: duplicate flag queue, identity directory, full identity history (profiles, memberships, placements, certifications, courses, flags). |
| Public | `/legal/terms` and `/legal/privacy` rendered the client documents | They render the unified documents with the section reader (table of contents, search, expandable sections). |

## Where the rules are enforced

- **No duplicate account**: `guardSignup` in `identity.service.ts` runs before any registration transaction (talent, applicant). Clients keep the business-email and unique-email checks and must tick the same checkbox.
- **One active profile**: `AgentProfile_one_active_per_user` and `AgentProfile_one_active_per_identity` in the data migration; `resolveActor` picks the non-archived profile and exposes `identityId`.
- **Hirewise only**: `FORBIDDEN_FOR_CLIENT` gains the identity keys; `FORBIDDEN_FOR_AGENCY` starts the agency allow-list; `identity.read` (Admin, Super Admin, Recruiter) and `identity.review` (Admin, Super Admin) guard the services.
- **Acceptance**: `acceptTermsTx` is the only writer, inside the caller's transaction, with `TERMS_ACCEPTED` audits; `termsStatusFor` decides the gate (`require-actor.ts` sends to `/agreements` when `termsRequired`). Staff are not gated unless `terms.gateStaff` is on (decision b).
- **Versions**: `publishTermsVersion` needs `terms.manage` (Super Admin, grantable); it deactivates the previous version and emits `TERMS_VERSION_PUBLISHED` (material + re-acceptance → notification per affected user). The legacy per-type publisher refuses superseded and unified types.
- **IP and user agent** stay on every acceptance (INV-I2, decision e).

## Migration and seed

`20261014090000_identity_terms_schema` (enums, columns, tables) and `20261014090001_identity_terms_data` (partial unique indexes, identity backfill from users and private contacts, unified terms and privacy v1 with checksums, deactivation of the superseded documents, role on historical acceptances). The data step embeds the same bodies as `src/server/terms/placeholder-terms.ts`; `scripts/gen-identity-terms-migration.ts` regenerates it and `tests/integration/identity-terms.test.ts` asserts the checksums match. The foundation seed upserts the same rows, so production needs only `npm run db:deploy`.

Every existing user in a required role (including the production admin, if `terms.gateStaff` is ever enabled) sees the single checkbox once on next sign-in because the document is new (decision d).

## Settings

- `identity`: `rejoinCreatesFreshProfile` (default true, decision a; used from phase 3), `duplicateCheckPhone`, `notifyExistingOnDuplicate`, `continuationLinkHours`.
- `terms`: `gateStaff` (default false).

## Tests

`tests/integration/identity-terms.test.ts`: migration and seed agreement, normalisation, sign-up identity and acceptance rows, the checkbox requirement, duplicate detection by email and phone variants, flag creation with notification and task, flag decisions and the continuation link, linking, identity reads and forbidden keys, contact sync, database constraints, the gate for legacy accounts and staff, per-role section marking, non-material versus material versions with re-acceptance and notifications, the acceptance report and CSV, and the contextual acceptance on an agency application. Updated: registration, agency foundation, launch, bootstrap, phase 5, views.

## Next

Phase 2: Agent Seats (plans, seat packages, append-only seat ledger, seat requests, capacity enforcement) and the invite-link join flow that consumes a seat, which also brings the old A2 invite and A3 course-seat foundations.
