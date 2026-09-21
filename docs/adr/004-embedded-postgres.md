# ADR-004: Embedded PostgreSQL for local development and tests

**Status:** Accepted, 2026-09-21

## Context

The master prompt assumes `docker compose up` for Postgres, MinIO, and Mailpit. The development machine has no Docker and no local Postgres. Tests must run against a real Postgres because the audit-log trigger, partial unique indexes, and `FOR UPDATE SKIP LOCKED` are Postgres features that SQLite or a mock cannot verify.

## Decision

- `npm run db:local` starts a real PostgreSQL 17 server from the `embedded-postgres` package (platform binaries installed by npm) on port 5433, data in `.pgdata/`.
- Vitest's global setup boots a throwaway embedded instance on a free port, runs `prisma migrate deploy`, and provides the URL to tests. `TEST_DATABASE_URL` overrides this so CI can use a service container.
- `docker-compose.yml` remains for developers who have Docker. CI pins `postgres:16`.
- Storage and email have local drivers (disk, console) so MinIO and Mailpit are optional.

## Consequences

- `npm test` works on a fresh clone with nothing installed but Node.
- Local development runs Postgres 17 while CI and production target 16. The schema uses no 17-only features; the drift check in CI runs against 16.
- First test run downloads nothing extra; binaries come with `npm install` (about 40 MB).
