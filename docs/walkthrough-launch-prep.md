# Launch prep walkthrough

Date: 2026-09-23. Closes the gaps between "all phases built" and "ready to go live": the Section 14 Q11 legal blocker gets tooling, Q18 retention gets a settings surface, the environment gets a readiness report, the Section 12 security baseline gets the missing pieces, and the seed reaches the Section 12 dataset.

## What was built

| Area | Where | Notes |
|---|---|---|
| Agreement versioning | `launch.service.ts`, `/staff/agreements` | Admin (`agreement.manage`) pastes counsel text and publishes version n+1; earlier versions deactivate, users in the required role are re-gated on their next visit, and old acceptances stay attached to their version with their checksum (INV-I2). Bodies are flagged while they contain `LEGAL_PLACEHOLDER`. No legal text is generated. |
| Public legal pages | `/legal/[slug]` | Render the active agreement text from the database once it has no placeholder; the outline stays as the fallback. |
| Launch readiness | `/staff/launch` (Super Admin) | Live checks: counsel text, `AUTH_SECRET` strength, HTTPS, storage, email, payment, meeting, and SMS providers, `DEV_EXPOSE_LINKS`, demo accounts, admin MFA, Super Admin present, retention confirmed, default deposit policy, Academy labels and templates, worker lag, failed jobs. Fails block; warnings need a decision. |
| Settings administration | `/staff/settings` (Super Admin) | Every `Setting` from Section 14 and the operational thresholds, typed by kind, audited with previous value and reason. Covers retention days (Q18), hours per month (Q6), reservation TTL, match weights, flag thresholds. |
| Security baseline | `next.config.ts`, `.github/workflows/ci.yml`, `package.json` | Security headers (nosniff, frame deny, referrer policy, permissions policy allowing same-origin camera and microphone, HSTS in production, no `x-powered-by`). Dependency audit is blocking at high severity in CI; transitive `postcss` and `deepmerge-ts` are pinned to patched versions through npm overrides (audit now reports zero findings). |
| Health endpoint | `/api/health` | Database ping and outbox lag for uptime monitors. |
| Section 12 dataset | `prisma/seed.ts` | 3 coaches, 6 courses, 25 agents at every profile stage (11 approved with rates, compensation, and three certifications), 6 clients (one pending review), shortlists for three clients, interview requests at REQUESTED, SALES_REVIEW, SCHEDULED, and CLOSED, placements at ACTIVE, AWAITING_DEPOSIT (open invoice), and DEPLOYMENT_PREP. Deterministic PRNG, idempotent by email, and Acme's shortlist stays empty for the e2e suite. |
| Docs | `docs/launch-checklist.md`, `docs/runbook.md` | Deployment on Vercel plus managed Postgres plus R2 with a separate worker, the full environment matrix, go-live sequence, rollback, and day-two operations. |

## Acceptance

| Criterion | Evidence |
|---|---|
| Publishing a version re-gates users and preserves acceptances | `tests/integration/launch.test.ts` |
| Readiness report reflects placeholders, secret strength, providers, accounts, settings, worker | Same test file; browser check on `/api/health`. |
| Settings updates are validated, permission-gated, and audited | Same test file. |
| Audit clean, lint, typecheck, build, unit, integration, e2e | See the final verification in the session log. |

## Still needed from Hirewise before go-live

1. Counsel text for all 12 agreements (paste under Staff → Agreements).
2. Retention periods (Staff → Settings).
3. Stripe, Zoom, Twilio, SMTP, and R2 credentials in the production environment.
4. Delete or anonymise the `.example` demo accounts after the roles and taxonomies are seeded.
