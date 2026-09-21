# ADR-001: Stack

**Status:** Accepted, 2026-09-21

## Context

Hirewise Connect is a single-tenant platform for one agency with a small engineering team. It needs relational integrity (rates, placements, deposits, audit), file storage for media, background jobs, and a marketing site. Hirewise chose the master prompt's defaults (Section 14).

## Decision

- **Next.js 15 App Router + TypeScript strict** for both the marketing site and the application. One deployable.
- **PostgreSQL** with **Prisma 6** and Prisma Migrate. Prisma 6 is pinned deliberately: Prisma 7 changed the client architecture and driver model, and the team gains nothing from it yet.
- **Tailwind CSS v4** with hand-written components (no component library dependency).
- **Zod** for environment and input validation, shared between client and server.
- **Auth.js v5** in Phase 1, database sessions, TOTP MFA for Super Admin and Admin.
- **S3-compatible storage** (Cloudflare R2 in production) behind a `StorageAdapter`; local disk driver for development.
- **SMTP via nodemailer** behind a `NotificationChannel`; console driver for development.
- **DB-backed outbox and job queue** with a Node worker process. No Redis until load requires it.
- **Vitest** for unit and integration tests, **Playwright** for end-to-end from Phase 1.
- **Pino** structured logging with field redaction for personal data.

## Consequences

- One repository, one build, one runtime. Services can be split out later because the service layer is already isolated.
- Every integration sits behind an interface with a local fake, so tests and local development need no external accounts.
- The worker is a second process in production (Railway or a small VPS) while the web app can run on Vercel.
