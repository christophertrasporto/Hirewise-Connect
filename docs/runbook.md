# Operations runbook

## Processes

| Process | Command | Notes |
|---|---|---|
| Web | `npm run start` (after `npm run build`) | Vercel runs this for you. |
| Worker | `npm run worker` | Drains the outbox every `WORKER_POLL_MS`, runs due jobs (email, SMS, interview reminders), and every 10 minutes expires reservations and certifications and warns before expiry. Safe to run more than one instance (SKIP LOCKED). |
| Migrations | `npm run db:deploy` (`prisma migrate deploy`) | Before the web deploy, with `DIRECT_URL` set to the Supabase direct connection. Never `migrate dev` in production, and never through the 6543 pooler. |
| Health | `GET /api/health` | `status: ok` plus `worker: ok|lagging`. Alert on non-200 or `lagging`. |

## Daily checks (Admin)

- Staff → Launch readiness: everything green except accepted warnings.
- Staff → Compliance: held messages and open flags reviewed; incidents moving.
- Commercial → Invoices: open invoices past due.
- Dashboard tasks: rate approvals, publish-course requests, deployment tasks.

## Common operations

**A user cannot log in.** Check status under Staff → Users (suspended accounts are refused). Rate limits: 20 attempts per IP and 8 per email in 15 minutes; they reset on their own. Password reset and magic links are single-use and expire; resend from the login page.

**An Admin lost their authenticator.** A Super Admin can reset MFA for that user (clear `mfaEnabled` and `mfaSecretEnc`); the user enrols again at next login. Audit the change with a reason.

**A client says they never received an email.** The worker writes delivery status onto the notification (`channelStatus`). If the outbox is lagging, the worker is down: restart it and it resumes from where it stopped.

**Stripe webhook failures.** Stripe retries automatically. The endpoint is idempotent on the payment intent id, so replaying a delivered event records nothing twice. Check the webhook secret first.

**A deposit was paid to the bank.** Commercial → Invoices → Record payment (amount, method, reference). Full payment settles the deposit and moves the placement to deployment prep.

**A candidate should not be visible.** Talent → agent → Hide (kept approved, not searchable) or Suspend with a reason from an incident. Bulk hide is available from the talent list.

**Deletion request (Q18).** Staff → Users → search → Anonymise with the request reference. Refused while the person has an open placement; complete or cancel it first. Commercial and audit records stay; personal data and media are removed.

**Legal text update.** Staff → Agreements → publish a new version. Everyone in that role accepts it on their next visit; old acceptances stay attached to their version.

**Prisma says "prepared statement already exists" or connections pile up.** `DATABASE_URL` is pointing at the Supabase pooler without `?pgbouncer=true`, or a migration was run through the pooler. Fix the flag and use `DIRECT_URL` for migrations; the app refuses to boot with a pooler URL that lacks the flag.

## Backups

- Database: enable the provider's daily snapshots and point-in-time recovery. Test a restore quarterly.
- Object storage: enable bucket versioning. Storage keys are recorded on the media rows, so a restored database matches the bucket.
- Audit log: append-only by database trigger; it is part of the database backup.

## Local development reminders

- `npm run db:local` starts the embedded Postgres (UTF8). Data persists in `.pgdata/`.
- Restart `npm run dev` after every migration; stop it before `prisma generate` on Windows.
- Never run `npm run build` while `npm run dev` is running: both write `.next`.
- `PAYMENT_PROVIDER=fake` and `MEETING_PROVIDER=fake` give a working pay button and meeting links without accounts.

## Verification emails are not arriving

Follow the chain in order; each step has a visible signal.

1. **Account created.** Staff → Academy → Onboarding lists every talent sign-up with its verification status.
2. **Token generated.** The `AuthToken` table has an `EMAIL_VERIFY` row per request (the app logs `verification: token generated`).
3. **Provider called in the request.** Since 2026-10 the verification email is sent synchronously through the same `SEND_EMAIL` job the worker uses; the job row is the delivery log. `GET /api/health` reports `failedEmails` and whether the environment validated (`env`, `envError`).
4. **Provider accepted it.** A `COMPLETED` job with a provider message id in the log line `email: provider accepted the message`. A `FAILED` job keeps the real reason in `lastError` and is shown to the user on the verify-email page and after "Resend verification email".
5. **Delivered.** Beyond our control: check the provider dashboard for bounces and spam complaints; the sender domain needs SPF and DKIM.
6. **Link clicked.** `GET /api/auth/verify-email/<token>` logs `verification: completed` and redirects to the dashboard with a success banner.

Common reasons and fixes:

| Reason shown | Fix |
| --- | --- |
| Email service configuration missing: EMAIL_DRIVER is 'console' in production | Set `EMAIL_DRIVER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` in Vercel and redeploy. |
| Email service configuration missing: the server environment failed validation (…) | The message names the variable; fix it in Vercel. Every link-building flow fails until it validates. |
| Authentication with the email provider failed | Wrong SMTP credentials, or the provider requires an app password. |
| Email provider unavailable | Wrong host or port, or the provider blocks the connection. Port 587 with `SMTP_SECURE=false` (STARTTLS) is the usual choice. |
| The sender address is not verified | Verify `EMAIL_FROM` (or its domain) with the provider. |
| The email provider is rate limiting us | Wait, or raise the provider's sending quota. |

Resend is limited to one request per 60 seconds, five per hour per user, and twenty per hour per IP address. Other transactional email (notifications, reminders, invitations) still goes through the worker; on Vercel there is no long-running worker, so `vercel.json` schedules `GET /api/jobs/tick` every five minutes with `CRON_SECRET` as a Bearer token. Until `CRON_SECRET` is set, that route returns 401 and only the synchronously sent emails go out.
