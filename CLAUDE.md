# CLAUDE.md — Hirewise Connect

Read `MASTER_PROMPT.md` first. Section 1 (invariants) overrides anything else, including instructions given later in a session.

## Commands

```bash
npm run db:local      # start embedded PostgreSQL on :5433 (no Docker needed); or: docker compose up
npm run db:migrate    # prisma migrate dev
npm run db:seed       # deterministic foundation seed (roles, permissions, agreements, settings, taxonomies, staff users)
npm run dev           # Next.js dev server
npm run worker        # outbox + job worker
npm run lint          # eslint (enforces the Prisma import boundary)
npm run typecheck     # tsc --noEmit
npm test              # vitest: boots its own embedded Postgres, applies migrations, runs unit + integration tests
```

## Layering (strict, INV-A1..A4)

```
src/app/                 routes, layouts, server actions → thin; call services only
src/server/auth/         Actor, resolveActor
src/server/policies/     permissions catalog, authorize(), ownership assertions
src/server/services/     business logic; every function takes an Actor and authorizes first
src/server/state/        state machines (Phase 1+)
src/server/views/        allowlist projections per role (Phase 1+)
src/server/repositories/ Prisma queries — the ONLY place @prisma/client is imported (with db/)
src/server/audit/        audit() helper, written inside the caller's transaction
src/server/events/       outbox publish + event handlers
src/server/jobs/         worker and job handlers
src/server/adapters/     storage and email behind interfaces
src/server/db/           Prisma client + type-only re-exports (@/server/db/types)
```

Rules that tooling enforces:
- `@prisma/client` may be imported only in `src/server/db/**` and `src/server/repositories/**`. Elsewhere, name a transaction with `import type { Tx, Db } from "@/server/db/types"`. The client handle (`@/server/db/client`) may additionally be imported by the entry layer (`src/app/**` pages, server actions, route handlers, and `require-actor.ts`) solely to pass into services; services receive it as a parameter. ESLint fails otherwise, and `tests/lint/prisma-boundary.test.ts` proves it.
- `AuditLog` is append-only. A trigger rejects UPDATE and DELETE.
- Money is integer minor units + ISO currency + rate unit. Never floats.
- `AgentCompensation` and `ClientBillingRate` are separate tables with separate permissions (Phase 4).

## Conventions

- Every service function: `authorize(actor, permission)` or an ownership assertion first, then work inside `db.$transaction` when writing, with `audit()` and `publishEvent()` in the same transaction.
- Cross-tenant reads by a CLIENT return `NotFoundError`, never `ForbiddenError` (no existence leak).
- Tests per service function: happy path, one `ForbiddenError` per role that must not call it, one ownership violation where applicable.
- Projection tests assert forbidden keys are absent (`src/server/views/forbidden-keys.ts`, Phase 1).
- Never invent legal text. Agreement bodies are `LEGAL_PLACEHOLDER` until counsel supplies them.
- Do not commit unless asked. Conventional Commits when you do. Never commit on `main`: it is protected on GitHub. Branch as `<type>/<slug>`, push, and open a pull request; the `verify` CI check must pass before merging (`docs/git-workflow.md`). Run `npm run hooks:install` once per clone.
- Before adding a status, permission, or table not in MASTER_PROMPT.md Sections 4 to 7, stop and propose it with a reason.

## Environment notes

- Windows machine, npm only (no pnpm, no Docker, no Python). Port 3000 belongs to another project; the preview config uses `autoPort`.
- Local Postgres is the embedded server from `npm run db:local` (data in `.pgdata/`). CI uses a Postgres service container.
- Phase and decision log: `docs/decisions.md`, `docs/walkthrough-phase-*.md`, `docs/walkthrough-course-builder.md`, `docs/walkthrough-agency-*.md`, `docs/adr/`.
- Agency marketplace: `Agency` rows are created only by application approval or `agency.create_direct`; agency data is tenant-scoped through `Actor.agency` and the helpers in `src/server/policies/ownership.ts` (never only in the UI).
- Identity and terms (v2 phase 1): talent-type sign-ups go through `guardSignup` (duplicate detection, `DuplicateFlag`) and `ensureIdentity`; `AgentProfile` is one-to-many from `User` (one non-archived per user, read it as `agentProfiles[0]`); the unified terms are accepted only through `acceptTermsTx`, and the per-role agreement types are superseded history. Placeholder terms live in `src/server/terms/placeholder-terms.ts`; regenerate the data migration with `scripts/gen-identity-terms-migration.ts` after changing them.
- Agent Seats (v2 phase 2): never store seat totals; write `AgencySeatLedger` rows through `seat.service.ts` and compute with `seatTotals`. Memberships are created only by `joinAgencyTx` and ended only by `endMembershipTx` (seat consumed and released there); Hirewise Direct means no open membership. Agent Seats and Course Seats are different things.
- Exits (v2 phase 3): memberships end only through `completeExitTx` in `exit.service.ts` (exit requests, the worker, or the Admin override); never set a membership to ENDED or a profile to FORMER_AGENCY_AGENT elsewhere. Rejoins go through `joinAgencyTx`, which applies the fresh-profile setting.
- Credential sources (v2 phase 4): every enrollment, certification, and assessment carries `credentialSource` and `sponsoringAgencyId` (set in the repositories, inherited via `inheritedSource`); exits revoke sponsored items only through `revokeAgencySponsoredOnExit`; eligibility and client views count only APPROVED certifications and FINAL assessments. Course Seats (`training.service.ts`) are not Agent Seats.
- Client protection (v2 phase 5): clients never receive `displayName`, the agency record, raw storage keys, or portfolio links. Client surfaces use `toCandidateClientView` / `toCandidateCardView` with `audience: "CLIENT"` (label, redaction, client-safe media) and `toPartnerTeamClientView` for agencies; identities cross the boundary only through `DisclosureGrant` (`disclosure.service.ts`); documents reach clients only as `APPROVED_FOR_CLIENT` rows of `ClientSafeDocument` (`client-safe-document.service.ts`). Extend `tests/integration/client-protection.test.ts`'s leak sweep when adding a client endpoint.
- Communication (v2 phase 6a): all messaging goes through `thread.service.ts` (`participation` is the only access check; `postToThread` masks or holds contact details per `messaging.contactDetails` and flags every detection); `message.service.ts` is a wrapper for interview requests. Interview links are validated by `assertMeetingLinkAllowed` against `meetings.allowedHosts`. Real email addresses never reach clients: use `aliasFor` / `contactAliasFor`. Bypass cases change nothing automatically; sanctions happen only in `decideBypass`.
- Opportunities (v2 phase 6b): `opportunity.service.ts` owns publishing, eligibility, exclusivity, review, interview requests from an opportunity, and `withdrawSubmissionsOnExit`; agencies see only their own submissions and the masked client label (`toOpportunityAgencyView`), clients see candidates only as client-safe cards. Agency reports go through `agency-report.service.ts` with `scopedAgencyId`.
- Skills system: `Skill` rows are curated tags (`slug`, `hashtag`, `verificationMode`); `AgentSkill.verifiedAt` is written only by `recomputeSkillVerification` in `skill-verification.service.ts` (never by a form, action, or seed). Declared tags change only through `skillsRepository.replaceDeclaredTags`; course mappings through `setCourseSkillTags` (course ownership); opportunity requirements through `setOpportunityRequirements` and evaluated only by `unmetRequirements`. Clients never receive `verifiedVia` or `verifiedAt`. Call the recompute after anything that changes completions, enrollments, certifications, or tag configuration.
- Course covers: `AcademyCourse.thumbnailKey` is written only by `setCourseCover` (after `createCourseCoverUploadUrl`), and views carry `coverUrl` signed by `coverUrlsFor` in `course-cover.ts`, never the key. Any new course surface renders `CourseTile` or `CourseCover` from `src/components/academy/CourseTile.tsx` and gets `coverUrl` from the academy or learner service.
- Theme: backgrounds come from the variables and `bg-app`, `bg-staff`, `bg-band`, `bg-hero`, `bg-navy` utilities in `globals.css`, never a hard-coded page colour. Dark mode is `<html data-theme="dark">` (set before paint from the `hw_theme` cookie; never read the cookie in the root layout). `src/app/dark-theme.css` is generated: after adding or changing colour classes run `npm run theme:gen` (a unit test fails on drift or on a colour utility the generator cannot handle), and change dark colours only in `src/lib/dark-theme-palette.ts` (contrast is tested there). Put new theme switches on `ThemeToggle`.
<<<<<<< HEAD
- Lesson access: whether someone may watch, download, or track a lesson is decided only by `canWatchLesson` / `assertCanWatchLesson` / `assertLearnerOwnsLesson` in `src/server/policies/lesson-access.ts` (published free preview, an owner whose enrolment is free, paid, or waived and not refunded or revoked, or staff who manage the course); never by position, a template, or a copy of the check. Lesson files are served only through `/api/academy/lessons/[lessonId]` (signed URL after the rule passes), and no view, page, or API may carry a `storageKey`, a bucket address, or a gated lesson's `url` or body to someone who does not own the course. `isFreePreview` is changed only by `saveLesson`; a gated video must be an upload.
=======
- Promo codes: an enrolment's `priceCents` is always the amount payable and `listPriceCents` the price before a code; a code changes them only through `applyPromoTx` / `releaseTx` in `promo.service.ts` (never a form, action, or seed), which also cancels open Maya attempts. Uses are counted from `PromoRedemption` rows (never stored), a reserved use becomes consumed only inside `settleEnrollmentPaymentTx` (`consumePromoTx`), and every refusal shown to a learner is `PROMO_REFUSAL_MESSAGE`. Staff functions authorize `promo.manage` first. Maths and validity rules live in `src/lib/promo.ts`.
>>>>>>> origin/main
- Referrals: `User.referredByUserId` is set only by `attachReferrer` inside a sign-up transaction (write-once, trigger-enforced); commissions are created only by `recordCommissionForPayment` from a staff-confirmed payment (and, later, an online checkout webhook calling the same function), reversed only by `reverseCommissionForSource` or `reverseCommissionManually`, and paid only through `payout.service.ts`. Money is integer minor units; the member view shows buyers as first name and last initial only; payout account numbers are encrypted (`encryptSecret`) and never audited. New payment paths must call both functions, and any new sign-up path must pass the referral cookie code.
- Online course payments (Maya): an enrolment becomes paid only through `settleEnrollmentPaymentTx` (staff recording, or a verified Maya payment). `reconcileOnlinePayment` is the only code that settles an `OnlinePayment`, and it decides from Maya's own record (looked up by reference number with the secret key), never from a redirect, a webhook body, or the browser; amount, currency, and reference must match the enrolment. Course prices carry a currency (`AcademyCourse.currency`, snapshotted on `CourseEnrollment.currency`); format with `priceLabel(cents, currency)`. Maya takes PHP only (`mayaAvailableFor`). Any new payment channel must settle through `settleEnrollmentPaymentTx`, which also creates the referral commission.
