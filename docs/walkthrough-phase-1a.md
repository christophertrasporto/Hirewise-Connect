# Phase 1A walkthrough — Authentication, agreements, registration, profile pipeline

Date: 2026-09-21. Second half of Phase 1 (media review queue, talent search, candidate profile for clients, shortlists, dashboard counters for clients) is Phase 1B.

## What was built

| Area | Where | Notes |
|---|---|---|
| Authentication | `src/server/auth/*`, `src/server/services/auth.service.ts` | Password (argon2id), magic link, email verification, password reset, TOTP MFA for Super Admin and Admin, DB sessions, rate limits. ADR-005. |
| Request gate | `src/server/auth/require-actor.ts` | Session → MFA → email verification → agreements. Used by `(app)` and `(gate)` layouts and by every server action. |
| Agreement gating | `src/server/services/agreement.service.ts`, `/agreements` | Each agreement accepted individually; version, checksum, IP, UA stored; audited. History at `/account/agreements`. |
| Client registration | `src/server/services/client.service.ts`, `/register/client` | Free-mail domains rejected (setting), verification email, session, `CLIENT_REGISTERED` → Sales notification + `QUALIFY_CLIENT` task. |
| Client activation | `/staff/clients` | Sales/Admin activate; Sales rep becomes account manager; client notified; task closed. |
| Agent registration | `src/server/services/agent.service.ts`, `/register/talent` | User + `AgentProfile` (DRAFT) + `AgentPrivateContact`. |
| Profile wizard | `/profile/*` | Personal, professional (+ industries), skills and software from taxonomy, experience, résumé and photo upload, video and voice upload. Completion % with weights from Section 8.2. |
| Submit and review | `src/server/state/agent-profile.ts`, `/staff/talent/[id]` | Guard: ≥80 %, résumé, video. Recruiter starts review / requests changes; Admin approves / rejects; hide and suspend. Every transition audited; agent notified. |
| Uploads | `src/server/services/media.service.ts`, `/api/storage/[...key]` | Presigned PUT (S3 or signed local route), MIME and size caps, ownership-scoped keys, confirm step. Signed download URLs only after an authorization check. |
| Views | `src/server/views/*` | Allowlist projections for agent self, candidate (client), staff list, client self/staff, with forbidden-key tests. |
| App shell | `src/app/(app)/*` | Role-based navigation, dashboards for agent, client, and staff, notifications, tasks. |
| Seed | `prisma/seed.ts` | Staff, an active client, and a draft agent, all with password `Hirewise!2026`. |

## Demo script

1. `npm run db:local`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, and `npm run worker` in a fourth terminal (emails and notifications are delivered by the worker).
2. **Talent:** log in as `maria@talent.example`. Dashboard shows 55 % complete. Upload a résumé (`/profile/resume`) and a video (`/profile/media`), then submit from `/profile`.
3. **Recruiter:** log in as `recruiter@hirewise.example`. Open Talent → Maria → Start review → Request changes (with feedback) or hand to an Admin.
4. **Admin:** log in as `admin@hirewise.example`. First login forces TOTP enrolment (scan with any authenticator). Approve Maria. She becomes Available.
5. **Client:** register at `/register/client` with a non-free-mail address. With `DEV_EXPOSE_LINKS=true` the verification link is shown on the verify-email page (Resend). Accept the five client agreements. Dashboard shows "being reviewed".
6. **Sales:** log in as `sales@hirewise.example`. Clients → Activate. The client is notified and their dashboard flips to active.

## Acceptance criteria touched (Section 13, Phase 1)

| Criterion | Status |
|---|---|
| Service tests: happy path + ForbiddenError per role + ownership violation | Present for auth, agreements, client, agent, media (`tests/integration/*`). |
| Client cannot fetch another client's record by id | Ownership unit tests plus `getOwnClient` deriving id from the actor; e2e (Playwright) still to add in 1B. |
| Agent responses never contain a `ClientBillingRate` | Rates arrive in Phase 4; forbidden-key list already includes them. |
| Unapproved media unreachable by clients | `media.test.ts`: client gets 404 on a submitted video, a URL on an approved one. |
| Agreement gating blocks every authenticated route | `requireAuth()` in both authenticated layouts; service test covers missing → accept → admitted. |

## Deviations and notes

- **Auth.js replaced by direct session management.** See ADR-005.
- **Import boundary refined.** The entry layer may import the client handle to pass into services; queries remain confined to repositories (ADR-002 updated).
- **Sales cannot see agent login emails** in lists or details (Section 6, footnote 1). Recruiters, Operations, Admins can.
- **Playwright** end-to-end isolation tests are deferred to Phase 1B once talent search exists (they need two clients viewing candidates).
- Browser file uploads were verified through the integration test, not the pane; the upload widget itself is straightforward XHR PUT.

## Test summary

`npm test`: 10 files, 80+ tests, on a throwaway embedded Postgres.
