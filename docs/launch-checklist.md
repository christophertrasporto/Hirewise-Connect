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
- **Database:** managed Postgres (Neon or Supabase), UTF8. Run `npx prisma migrate deploy` on each release before the web deploy finishes (Vercel "build command" or a release step).
- **Object storage:** Cloudflare R2 (S3-compatible) with a private bucket. No public access; every download is a short-lived signed URL.
- **Worker:** one always-on process running `npm run worker` (Railway, Fly, or a small VPS). Same `DATABASE_URL`, storage, email, SMS, and payment variables as the web app. The readiness page flags an outbox that is not being drained.
- **Health:** `GET /api/health` returns database and worker status for uptime checks.

## 3. Environment variables (production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<your-domain>` |
| `DATABASE_URL` | managed Postgres connection string (pooled) |
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

1. Provision the database; run `npx prisma migrate deploy`.
2. Run the seed **only** for roles, permissions, agreements, settings, and taxonomies, then delete the demo accounts (every `*.example` login) from Staff → Users, or run the seed against an empty database and anonymise them. The readiness page warns while any `.example` account exists.
3. Create the real Super Admin, sign in, enrol MFA, then create Admin, Sales, Recruiter, Coach, and Operations accounts.
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
