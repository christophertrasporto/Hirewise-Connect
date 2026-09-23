# ADR 006 — Supabase as managed Postgres only

Date: 2026-09-23. Status: accepted.

## Context

The application owns authentication (argon2id, database sessions, magic links, TOTP MFA), authorization (permission catalog plus ownership assertions in the service layer), and an audit trail enforced by a database trigger. Section 14 Q15 of the spec defaults hosting to Vercel with managed Postgres. Vercel functions open many short-lived connections, and Prisma migrations need a session-mode connection.

## Decision

- Supabase is used as the **managed PostgreSQL provider**, one project per environment (staging, production). Supabase Auth, Row Level Security, and the Supabase client SDK are **not** adopted: they would duplicate the service-layer model that the invariants in Section 1 depend on.
- The app connects through the **Supavisor transaction pooler** (`DATABASE_URL`, port 6543, `?pgbouncer=true&connection_limit=1`). Migrations run through the **direct connection** (`DIRECT_URL`, port 5432) via Prisma's `directUrl`.
- Migrations are applied by `npm run db:deploy` (`prisma migrate deploy`) from a release step or CI, never from the Vercel build, and never with `migrate dev`.
- Local development, tests, and CI keep their own Postgres. `DIRECT_URL` simply equals `DATABASE_URL` there. Supabase is a deployment target, not a development dependency.
- The worker stays a separate always-on process (Railway, Fly, or a VPS). A cron-triggered tick endpoint is the fallback if everything must live on Vercel.

## Consequences

- One new environment variable, validated at boot. Misconfigured pooler strings fail fast with a clear message.
- Supabase Storage may later replace R2 through the existing S3 adapter without code changes.
- Free-tier Supabase projects pause after inactivity; staging should be on a paid plan or the pause accepted.
