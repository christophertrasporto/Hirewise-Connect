# Decisions log

Answers to MASTER_PROMPT.md Section 14. On 2026-09-21 Hirewise chose **"use the defaults"** for every question. Each row can be revisited; changing one after its phase ships is a migration, not a config flip.

| # | Question | Decision | Where it lives |
|---|---|---|---|
| Q1 | Academy platform | Built inside Connect; signed inbound completion endpoint for a future LMS | Section 4.4, Phase 3 |
| Q2 | Marketplace access | Gated: verified, agreement-accepted clients only | `Setting.marketplaceAccess = GATED` |
| Q3 | Agent identity | Display name + photo; legal name at `SCHEDULED` interview | `Setting.identityDisclosureLevel = DISPLAY_NAME` |
| Q4 | Agent sees own client rate | Hidden; boolean "published" flag only | Section 6 footnote 6 |
| Q5 | Rate unit and currency | Both `HOURLY` and `MONTHLY`; client default USD; compensation currency per record | `Setting.defaultClientCurrency = USD` |
| Q6 | "One month" for hourly rates | `rate × hoursPerMonthDefault` | `Setting.hoursPerMonthDefault = 173` |
| Q7 | Placed/Reserved visibility | Visible with badge; default filter shows Available or Soon | Phase 1 search |
| Q8 | Payments | Manual recording in Phase 4; Stripe adapter Phase 5 | `PaymentProvider` interface |
| Q9 | Contracts | Click-to-accept `AgreementAcceptance` with `placementId`, optional signed PDF | Phase 4 |
| Q10 | Interview meetings | Sales pastes a link | Phase 2 |
| Q11 | Agreement texts | Placeholders. **Launch blocker** until counsel supplies text | `prisma/seed.ts`, `/legal/*` |
| Q12 | Data migration | None | — |
| Q13 | Sales rate authority | Propose only | Section 7 |
| Q14 | Account manager assignment | Manual | `Setting.autoAssignAccountManager = false` |
| Q15 | Hosting | Vercel + managed Postgres + R2; worker on Railway or a VPS | ADR-001 |
| Q16 | Post-deployment client features | Out of scope | — |
| Q17 | Languages | English only | — |
| Q18 | Data protection | Retention setting + soft delete + anonymisation job; periods to confirm | Phase 5 |

## Phase 0 deviations from the master prompt

- **Postgres 17, not 16, for local development.** The machine has no Docker. Local dev and tests use real Postgres binaries via `embedded-postgres` (17.x). Docker Compose and CI still pin `postgres:16`. Nothing in the schema is version-specific. See ADR-004.
- **Local disk storage and console email drivers** exist alongside the S3 and SMTP adapters, because MinIO and Mailpit need Docker. Production uses S3 and SMTP.
- **Password hashing** is argon2id via `@node-rs/argon2` (Phase 1A). Seeded accounts share the demo password `Hirewise!2026`.

## Phase 1A deviations

- **Auth.js was not used.** Sessions, tokens, and TOTP are implemented directly so that per-session MFA state and the agreements gate live in the service layer. See ADR-005.
- **Import boundary refined:** the entry layer may import the Prisma client handle to pass into services; queries stay in repositories (ADR-002).
- **Sales never sees agent login email or phone** in lists or details, matching Section 6 footnote 1.

## Phase 2 notes

- **Sales request queue is shared.** Any Sales rep may pick up an unassigned interview request (`interview.read_all`); acting on a client's shortlist or requirement still needs assignment. A request is auto-assigned to the client's account manager when one exists.
- **Client and agent never message each other directly.** Their messages carry CLIENT_AND_HIREWISE or AGENT_AND_HIREWISE visibility; Hirewise relays. Contact details are held for review; rate talk is flagged.
- **Selection reserves the candidate** for the client for `reservationTtlDays`. The hold belongs to the account manager, who receives the expiry warnings.
- **Restart the dev server after every migration.** The running Next.js process keeps the previously generated Prisma client; new models are undefined until restart.

## Phase 3 notes

- **Coaches author courses and exams (owner request, 2026-09-23).** New permission `course.create_own` on COACH scopes creation and editing to courses the coach owns or is assigned to (INV-P5). Publishing stays with Admin (`course.manage`), which is also where a certification template is linked.
- **Every course has a USD price (owner request).** `AcademyCourse.priceCents` + `currency = USD`, 0 = free. Enrolment snapshots the price. Paid courses stay locked until Hirewise records the payment offline; `course.payment.record` was added for SALES, OPERATIONS, and ADMIN. Card processing remains Phase 5 (Q8).
- **`verification.manage`** (ADMIN, SUPER_ADMIN) covers editing the verification ladder, certification templates, and assessment result labels.
- **Coach-reviewed certifications are approved on the coach recommendation**; exam-only templates approve automatically when the score clears `minExamScore`. Admin can still issue directly or revoke, always with a reason.
- **Local Postgres clusters are now initialised as UTF8.** The embedded server on Windows defaulted to WIN1252, which rejects characters outside Latin-1 (found when a notification body contained an arrow). New clusters (`npm run db:local` on a fresh `.pgdata/`, and every test run) pass `--encoding=UTF8 --locale=C`. An existing `.pgdata/` keeps WIN1252 until it is deleted and re-seeded.
- **Agent-facing Academy lives at `/courses`** because `/academy` is the public marketing page.

## Phase 4 notes

- **Deposit and invoice are created at Hirewise approval**, not at agreement acceptance, so the client sees the exact amount inside the rendered service agreement. The DEPOSIT_REQUIRED notification is sent when the agreement is accepted (entering AWAITING_DEPOSIT).
- **Coach-style scoping for Sales on placements:** a Sales rep sees and acts on placements for assigned clients only, whatever the catalog grants, matching `assertClientOwns`.
- **Invoice numbering** is `HW-<year>-<5 digits>` from a count inside the transaction; a unique constraint guards collisions.
- **Invoice PDFs** use a dependency-free single-page writer (`src/server/adapters/pdf.ts`) stored in private object storage and served by signed URL; no PDF library was added.
- **Recurring invoicing** after activation is not automated in Phase 4; only the deposit invoice is generated. Monthly billing runs can be added as a worker job in Phase 5.
- **Do not run `next build` while the dev server is running.** Both write `.next`; the running server then fails with ENOENT until `.next` is deleted and the server restarted (hit during Phase 4 verification).

## Phase 5 notes

- **`SavedSearch` table added** (not in Section 4). Section 13 Phase 5 requires saved searches for the client portal; a table keyed by client with a JSON filter set in the marketplace search schema is the smallest faithful shape.
- **`Incident` created as specified in Section 4.8**; it had not been built in earlier phases. Evidence is stored as `Document` rows (kind INCIDENT_EVIDENCE) referenced by id.
- **Matching is rule-based only** (INV-C6). Hard rules never score; soft rules use `Setting.matchWeights`. Skill coverage below 100% still scores proportionally but zero coverage is a hard fail. Timezone credit uses the wrapped hour difference (Manila vs Los Angeles counts as 9h).
- **Integrations ship behind adapters with local fakes:** `PAYMENT_PROVIDER=manual|fake|stripe`, `MEETING_PROVIDER=none|fake|zoom`, `SMS_DRIVER=console|twilio`. The fake payment route is refused in production. Stripe and Zoom use their REST APIs directly (no SDKs).
- **Online payments reuse the manual settlement path** (`recordProviderPayment` → deposit → placement), keyed idempotently on the provider reference, and are recorded as method CARD under the system actor.
- **Data protection (Q18):** anonymisation keeps commercial and audit rows and scrubs personal data; the retention job is admin-run from Compliance → Data protection until retention periods are confirmed with counsel. Default `retentionDays` is 730.
- **Section 8.8 thresholds** are settings: `profileViewBurstPerHour` (60) and `shortlistChurnPerDay` (12).

## Launch prep notes

- **No legal text was written.** Agreement bodies stay `LEGAL_PLACEHOLDER` until counsel text is pasted under Staff → Agreements; the readiness page fails until then (Q11).
- **Agreement versions are immutable.** Publishing creates version n+1 and deactivates the previous; acceptances keep their version and checksum. Republish an earlier body as a new version to roll back.
- **Dependency audit is blocking at high severity in CI.** Transitive `postcss` (under `next`) and `deepmerge-ts` (under `@prisma/config`) are pinned via npm `overrides` to patched releases; Prisma CLI and the build were verified after the pin.
- **Security headers** are set in `next.config.ts`; a strict Content-Security-Policy is deferred until a nonce pipeline for Next.js inline scripts is added.
- **Retention job stays admin-run** until periods are confirmed with counsel; `retentionDays` is editable under Staff → Settings and the readiness page warns while it is the default.
- **Seed** now matches Section 12 volumes and is idempotent by email; e2e specs rely on Acme's shortlist being empty and on the names Jose R., Carlo D., and Maria S. being unique.

## Supabase integration notes

- **Supabase is managed Postgres only** (ADR 006). Authentication, sessions, and authorization stay in the app; Supabase Auth and RLS are not used.
- **Two connection strings:** `DATABASE_URL` (transaction pooler, `?pgbouncer=true&connection_limit=1`) for the app and `DIRECT_URL` (direct) for `prisma migrate` via Prisma `directUrl`. Locally and in CI both equal the same server. Boot fails fast when a pooler URL lacks the flag or `DIRECT_URL` also points at the pooler.
- **Migrations run from a release step or CI** (`npm run db:deploy`), not from the Vercel build.
