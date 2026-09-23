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
- Phase and decision log: `docs/decisions.md`, `docs/walkthrough-phase-*.md`, `docs/adr/`.
