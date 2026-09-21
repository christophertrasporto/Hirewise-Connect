# Phase 0 walkthrough — Scaffold and foundations

Date: 2026-09-21. Decisions: all Section 14 defaults (see `docs/decisions.md`).

## What was built

| Area | Files | Notes |
|---|---|---|
| Schema | `prisma/schema.prisma`, `prisma/migrations/*` | 31 tables: identity and RBAC, clients, agents and media, agreements, audit, outbox, jobs, settings, notifications. `citext` for emails. |
| Append-only audit | `prisma/migrations/20260921081300_*` | Trigger rejects UPDATE and DELETE on `AuditLog`; TRUNCATE also blocked outside `*_test` databases. Partial unique index: one active reservation per agent. |
| Permission catalog | `src/server/policies/permissions.ts` | 57 permissions, role matrix from Section 7. Seeded to the database. |
| Actor and authorize | `src/server/auth/actor.ts`, `src/server/auth/resolve-actor.ts`, `src/server/policies/authorize.ts`, `src/server/policies/ownership.ts` | `authorize()`, `assertClientOwns()`, `assertAgentOwns()`, `assertCoachAssigned()`, `scopedClientId()`. Cross-tenant reads return 404, not 403. |
| Audit helper | `src/server/audit/audit.ts` | Writes inside the caller's transaction. Typed action list. |
| Outbox and worker | `src/server/events/*`, `src/server/jobs/*`, `scripts/worker.ts` | `publishEvent()` in-transaction; worker drains events with `SKIP LOCKED`, runs jobs with backoff. First event: `USER_CREATED` → in-app notification → `SEND_EMAIL` job. |
| Adapters | `src/server/adapters/storage.ts`, `src/server/adapters/email.ts` | `StorageAdapter` (S3/R2 + local disk), `NotificationChannel` (SMTP + console). |
| Env | `src/server/env.ts` | Zod-validated, lazy, fails fast with readable errors. |
| Settings service | `src/server/services/setting.service.ts` | Reference implementation of the service pattern: authorize → transaction → write + audit + event. |
| Seed | `prisma/seed.ts` | Roles, permissions, 12 agreement placeholders, settings, 22 skills, 20 software, 6 staff users. Idempotent. |
| Local DB | `scripts/db-local.ts`, `docker-compose.yml` | Embedded Postgres 17 without Docker, or Compose with Postgres 16, MinIO, Mailpit. |
| Lint boundary | `eslint.config.mjs`, `tests/lint/prisma-boundary.test.ts` | Prisma importable only in `db/` and `repositories/`. |
| CI | `.github/workflows/ci.yml` | validate, drift check, lint, typecheck, test, build. |
| Docs | `CLAUDE.md`, `docs/adr/001-004`, `docs/erd.md`, `docs/decisions.md` | |

## How to run it

```bash
npm install
npm run db:local          # terminal 1: Postgres on :5433 (or: docker compose up)
npm run db:migrate        # terminal 2
npm run db:seed
npm run dev               # web
npm run worker            # terminal 3: outbox + jobs
npm test                  # boots its own throwaway Postgres
```

Seeded staff accounts (no passwords until Phase 1): `owner@`, `admin@`, `sales@`, `recruiter@`, `coach@`, `ops@` at `hirewise.example`.

## Acceptance criteria (Section 13, Phase 0)

| Criterion | Result |
|---|---|
| Fresh clone → DB up → migrate, seed, dev works | Yes. Without Docker via `npm run db:local`. |
| `authorize` unit tests pass | Yes. 42 tests across 6 files, including role-matrix invariants for INV-C1, C3, C5, P5. |
| ESLint blocks Prisma import outside allowed folders | Yes, and `tests/lint/prisma-boundary.test.ts` proves it with in-memory files rather than a deleted fixture. |
| Audit trigger rejects UPDATE/DELETE (integration test) | Yes, via raw SQL and via Prisma. |
| Migration drift check | `prisma migrate diff` reports no difference. |

## Deviations

- Postgres 17 locally (embedded), 16 in CI and Compose. See ADR-004.
- Local-disk storage and console email drivers added for Docker-less development.
- `package.json#prisma.seed` is deprecated in Prisma 7; we are pinned to 6 (ADR-001).

## Next: Phase 1

Order from Appendix A: agreements gating → client registration → agent registration and profile → media upload and review → admin talent management → search → candidate profile → shortlist → dashboards. Phase 1 also adds Auth.js, password hashing, sessions, the `views/` projection layer with `forbidden-keys.ts`, and the first Playwright isolation tests.
