# Hirewise Connect

Agency-controlled talent marketplace for Hirewise Virtual Assistance Services.

The full build specification lives in [MASTER_PROMPT.md](./MASTER_PROMPT.md). Progress and decisions live in
[docs/decisions.md](./docs/decisions.md) and `docs/walkthrough-phase-*.md`. Conventions for contributors and for
Claude Code are in [CLAUDE.md](./CLAUDE.md).

## Status

| Phase | State |
|---|---|
| Corporate site + auth screens | Done (UI only) |
| Phase 0 — Scaffold and foundations | Done: schema, RBAC, audit, outbox/jobs, adapters, seed, CI |
| Phase 1A — Auth, agreements, registration, profile wizard, uploads, review pipeline | Done |
| Phase 1B — Media review, talent search, candidate profiles, shortlists, e2e isolation tests | Done |
| Phase 2 — Requirements, interview requests, mediated messaging, scheduling, decisions, placements, reservations | Done |
| Phase 3 — Academy: coach-built courses with USD pricing, exams, assessments, certifications, verification ladder | Done |
| Phase 4 — Commercial: billing rates with history, compensation, placement pipeline, deposits, invoices (PDF), manual payments, reports | Done |
| Phase 5 — Advanced: rule-based matching, analytics, saved searches, in-browser recording, Stripe/Zoom/SMS adapters with fakes, incidents, bulk actions, data export, retention | Done |
| Launch prep — agreement versioning, readiness checks, settings admin, security headers, health endpoint, clean audit, Section 12 seed | Done |
| Go-live — needs counsel text (Q11), retention periods (Q18), and production credentials; see docs/launch-checklist.md | Next |

Deployment and operations: [docs/launch-checklist.md](./docs/launch-checklist.md) and [docs/runbook.md](./docs/runbook.md). Contributing: [docs/git-workflow.md](./docs/git-workflow.md) (protected `main`, feature branches, pull requests; run `npm run hooks:install` once per clone).

## Run locally

```bash
npm install
npm run db:local      # terminal 1: embedded PostgreSQL on :5433 (no Docker needed)
npm run db:migrate    # terminal 2
npm run db:seed
npm run dev           # http://localhost:3000
npm run worker        # terminal 3: outbox + job worker (delivers emails and notifications)
```

With Docker instead: `docker compose up` gives Postgres 16, MinIO, and Mailpit; set `DATABASE_URL` to port 5432.

## Verify

```bash
npm run lint
npm run typecheck
npm test              # boots a throwaway Postgres, applies migrations, runs unit + integration tests
npm run test:e2e      # Playwright against the running dev server and seeded database
```

## Routes today

| Route | Purpose |
|---|---|
| `/` | Corporate landing page |
| `/for-clients`, `/for-talent`, `/academy`, `/how-it-works`, `/about`, `/contact` | Corporate sub-pages |
| `/login`, `/forgot-password`, `/reset-password/[token]` | Authentication |
| `/register`, `/register/client`, `/register/talent` | Registration |
| `/verify-email`, `/agreements`, `/mfa/*` | Gates every user passes before the app |
| `/dashboard`, `/profile/*`, `/company`, `/notifications`, `/account/agreements` | Authenticated app |
| `/talent`, `/talent/[id]`, `/shortlist`, `/shortlist/compare` | Client marketplace (active clients only) |
| `/requirements`, `/interviews`, `/interviews/new`, `/interviews/[id]`, `/placements` | Client and talent interview workflow |
| `/staff/clients`, `/staff/talent/*`, `/staff/media`, `/staff/shortlists`, `/staff/interviews/*`, `/staff/placements`, `/staff/reservations`, `/staff/compliance` | Hirewise staff console |
| `/legal/*` | Agreement outlines marked `LEGAL_PLACEHOLDER` |

## Demo accounts

Production and staging use `npm run db:seed:foundation` (reference data, no accounts) followed by `npm run bootstrap:admin -- --email <you>`; see `docs/launch-checklist.md`. Locally, after `npm run db:seed`, every account uses the password `Hirewise!2026`: `owner@`, `admin@`, `sales@`, `recruiter@`, `coach@`, `ops@` at `hirewise.example`, plus `hiring@acme-solar.example` and `ops@beta-corp.example` (active clients), `maria@talent.example` (draft agent), and `jose@`, `ana@`, `carlo@talent.example` (approved agents; `jose@` holds a certification, `ana@` has a pending course payment). `coach@` owns three Academy courses (two published, one draft). `carlo@` is ACTIVE at Acme Solar with a paid deposit invoice; `jose@` and `carlo@` have published client rates; `ana@` has a pending rate proposal for Admin. Local `.env` uses the fake payment and meeting providers (`PAYMENT_PROVIDER=fake`, `MEETING_PROVIDER=fake`). Local `.env` uses the fake payment and meeting providers (`PAYMENT_PROVIDER=fake`, `MEETING_PROVIDER=fake`). Admin roles are asked to enrol TOTP on first login. Set `DEV_EXPOSE_LINKS=true` in `.env` to see emailed links in the UI locally.

## Stack

Next.js 15, React 19, TypeScript, Tailwind CSS v4, Prisma 6 on PostgreSQL, Zod, Pino, Vitest. See `docs/adr/`.
