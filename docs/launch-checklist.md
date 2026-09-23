# Launch checklist

The live version of this list is **Staff → Launch readiness** (`/staff/launch`, Super Admin), which checks the running environment. This document covers the steps the app cannot check for itself.

## 1. Blockers

| Item | Owner | Where |
|---|---|---|
| Counsel-approved text for all 12 agreements (Section 14 Q11). Every active version still contains `LEGAL_PLACEHOLDER`. | Hirewise + counsel | Paste and publish under Staff → Agreements. Publishing a new version re-gates every user in that role on their next visit. The Placement Service Agreement keeps its `{{companyName}}`, `{{agentName}}`, `{{positionTitle}}`, `{{schedule}}`, `{{billingRate}}`, `{{deposit}}`, `{{startDate}}` placeholders. |
| Retention periods for PH Data Privacy Act and GDPR (Q18) | Hirewise + counsel | Staff → Settings → Retention period (days). The retention job is admin-run from Compliance → Data protection. |
| Production credentials: Stripe (secret key, webhook secret), Zoom Server-to-Server app, Twilio, SMTP relay, R2 or S3 bucket | Hirewise | Environment variables below. |

## 2. Hosting (Section 14 Q15 default)

- **Web:** Vercel project from this repo. Build command `npm run build` (runs `prisma generate`). Node 24.
- **Database:** Supabase managed Postgres, one project per environment (ADR 006). Two connection strings per environment: the pooled one for the app and the direct one for migrations. Run `npm run db:deploy` on each release before the web deploy is promoted (see Section 2a).
- **Object storage:** Cloudflare R2 (S3-compatible) with a private bucket. No public access; every download is a short-lived signed URL.
- **Worker:** one always-on process running `npm run worker` (Railway, Fly, or a small VPS). Same `DATABASE_URL`, storage, email, SMS, and payment variables as the web app. The readiness page flags an outbox that is not being drained.
- **Health:** `GET /api/health` returns database and worker status for uptime checks.

## 2a. Supabase and Vercel setup

Supabase is used as managed Postgres only. The app keeps its own authentication, sessions, and authorization (ADR 006); Supabase Auth and Row Level Security are not used.

**Create the projects**

1. Create two Supabase projects, `hirewise-connect-staging` and `hirewise-connect-prod`, in the region closest to your Vercel region. Save each database password in a password manager; it is shown once.
2. In each project, Database → Extensions: enable `citext` (the first migration also runs `CREATE EXTENSION IF NOT EXISTS citext`, which needs it to be available).

**Collect the two connection strings per project** (Project Settings → Database → Connection string):

| Variable | Which string | Notes |
|---|---|---|
| `DATABASE_URL` | **Transaction** pooler, port 6543 | Append `?pgbouncer=true&connection_limit=1`. Used by the Vercel functions. Prepared statements are unsupported on this pooler, which is what the flag tells Prisma. |
| `DIRECT_URL` | **Session** (direct) connection, port 5432 | Used only by `npm run db:deploy`. Never the 6543 pooler. |

Both contain the database password, so they are secrets: put them only in Vercel environment variables and your local password manager, never in the repository.

**Apply the schema** (from your machine or CI, once per environment):

```bash
DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run db:deploy
```

Then seed the foundation data only with `npm run db:seed:foundation` (roles, permissions, agreement placeholders, settings, taxonomies, Academy labels and templates, verification ladder, deposit policies; no accounts) and create the first Super Admin with `npm run bootstrap:admin -- --email <you> --production`. The plain `db:seed` (demo accounts) refuses Supabase hosts unless `ALLOW_DEMO_SEED=1`.

**Connect Vercel**

1. Import the GitHub repository into Vercel. Framework: Next.js; build command `npm run build`; Node 24.
2. Environment variables: set the production pair on the Production environment and the staging pair on Preview. Add the rest of Section 3 alongside. Do not use the Vercel-Supabase marketplace integration's default variables (they target Supabase Auth); enter `DATABASE_URL` and `DIRECT_URL` by hand.
3. Every pull request gets a Preview deployment against staging; `main` deploys to Production. Migrations are not run by the build: run `npm run db:deploy` for the target environment before promoting a release that contains new migrations. CI's drift check guarantees the migration folder matches the schema.
4. Keep the worker (`npm run worker`) on Railway, Fly, or a VPS with the same variables. If it must run on Vercel, ask for the cron-triggered tick endpoint described in the runbook.

**Verify:** `GET /api/health` returns `database: ok`, and Staff → Launch readiness shows the "Database connection" check passing with the pooler in use.

## 3. Environment variables (production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<your-domain>` |
| `DATABASE_URL` | Supabase transaction pooler string (port 6543) with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase direct connection string (port 5432), migrations only |
| `AUTH_SECRET` | `openssl rand -base64 32` (32+ characters; rotating it signs everyone out and invalidates MFA secrets) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | R2 or S3 credentials |
| `SIGNED_URL_TTL_SECONDS` | `600` |
| `EMAIL_DRIVER` | `smtp` |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | transactional email relay |
| `PAYMENT_PROVIDER` | `stripe` (or `manual` to launch with offline payments only; `fake` is refused in production) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | from the Stripe dashboard; webhook endpoint `https://<your-domain>/api/webhooks/stripe`, event `checkout.session.completed` |
| `MEETING_PROVIDER` | `zoom` or `none` |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom Server-to-Server OAuth app with `meeting:write` |
| `SMS_DRIVER` | `twilio` or `console` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio messaging |
| `DEV_EXPOSE_LINKS` | `false` |
| `LOG_LEVEL` | `info` |
| `WORKER_POLL_MS` | `2000` |

## 4. Go-live sequence

1. Provision the Supabase projects (Section 2a); run `npm run db:deploy` with the environment's `DIRECT_URL`.
2. Run `DATABASE_URL=<session pooler> npm run db:seed:foundation`: reference data only, no accounts, safe to re-run. Never run the plain `db:seed` here; it refuses Supabase hosts because every demo account shares a published password. The readiness page warns while any `.example` account exists.
3. Create the real Super Admin with `npm run bootstrap:admin -- --email <you> --production` (reads `PROD_DIRECT_URL` from the local, git-ignored `.env`; prints a one-time password unless `BOOTSTRAP_ADMIN_PASSWORD` is set). Sign in, enrol MFA, then create Admin, Sales, Recruiter, Coach, and Operations accounts from Staff → Users. Re-run with `--reset-password` to rotate the password until SMTP delivers reset links.
4. Publish counsel text for every agreement (Staff → Agreements) and confirm the readiness page shows no placeholder failures.
5. Set retention days, hours per month, reservation TTL, and match weights under Staff → Settings. Check deposit policies under Commercial → Deposit policies.
6. Configure Stripe, Zoom, Twilio, SMTP, and storage; redeploy; confirm the readiness page is all green apart from deliberate warnings.
7. Start the worker and confirm `GET /api/health` reports `worker: ok`.
8. Point DNS, confirm HTTPS, and re-run the readiness page (the HTTPS check reads `APP_URL`).
9. Run the smoke test from the runbook: register a client, activate, search, shortlist, request an interview, schedule, select, approve, accept the agreement, pay, activate.

## 5. Rollback

- Web: redeploy the previous Vercel build.
- Database: migrations are forward-only. Take a snapshot before `migrate deploy`; restore the snapshot and redeploy the previous build if a migration must be undone.
- Agreements: publishing a version never deletes the previous one; republish the earlier body as a new version if needed.
