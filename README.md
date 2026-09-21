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
| Phase 1 — Foundation (auth, registration, profiles, media, search, shortlists) | Next |
| Phases 2–5 | Planned |

## Run locally

```bash
npm install
npm run db:local      # terminal 1: embedded PostgreSQL on :5433 (no Docker needed)
npm run db:migrate    # terminal 2
npm run db:seed
npm run dev           # http://localhost:3000
npm run worker        # terminal 3, optional: outbox + job worker
```

With Docker instead: `docker compose up` gives Postgres 16, MinIO, and Mailpit; set `DATABASE_URL` to port 5432.

## Verify

```bash
npm run lint
npm run typecheck
npm test              # boots a throwaway Postgres, applies migrations, runs unit + integration tests
```

## Routes today

| Route | Purpose |
|---|---|
| `/` | Corporate landing page |
| `/for-clients`, `/for-talent`, `/academy`, `/how-it-works`, `/about`, `/contact` | Corporate sub-pages |
| `/login`, `/forgot-password` | Sign-in screens (UI only until Phase 1) |
| `/register`, `/register/client`, `/register/talent` | Account-type chooser and registration outlines |
| `/legal/*` | Agreement outlines marked `LEGAL_PLACEHOLDER` |

## Stack

Next.js 15, React 19, TypeScript, Tailwind CSS v4, Prisma 6 on PostgreSQL, Zod, Pino, Vitest. See `docs/adr/`.
