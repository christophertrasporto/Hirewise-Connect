# Decisions log

Answers to MASTER_PROMPT.md Section 14. On 2026-09-21 Hirewise chose **"use the defaults"** for every question. Each row can be revisited; changing one after its phase ships is a migration, not a config flip.

| # | Question | Decision | Where it lives |
|---|---|---|---|
| Q1 | Academy platform | Built inside Connect; signed inbound completion endpoint for a future LMS | Section 4.4, Phase 3 |
| Q2 | Marketplace access | Gated: verified, agreement-accepted clients only | `Setting.marketplaceAccess = GATED` |
| Q3 | Agent identity | Display name + photo; legal name at `SCHEDULED` interview | `Setting.identityDisclosureLevel = DISPLAY_NAME` |
| Q4 | Agent sees own client rate | Hidden; boolean "published" flag only | Section 6 footnote 6 |
| Q5 | Rate unit and currency | Both `HOURLY` and `MONTHLY`; client default USD; compensation currency per record | `Setting.defaultClientCurrency = USD` |
| Q6 | "One month" for hourly rates | `rate × hoursPerMonthDefault` | `Setting.hoursPerMonthDefault = 173` |
| Q7 | Placed/Reserved visibility | Visible with badge; default filter shows Available or Soon | Phase 1 search |
| Q8 | Payments | Manual recording in Phase 4; Stripe adapter Phase 5 | `PaymentProvider` interface |
| Q9 | Contracts | Click-to-accept `AgreementAcceptance` with `placementId`, optional signed PDF | Phase 4 |
| Q10 | Interview meetings | Sales pastes a link | Phase 2 |
| Q11 | Agreement texts | Placeholders. **Launch blocker** until counsel supplies text | `prisma/seed.ts`, `/legal/*` |
| Q12 | Data migration | None | — |
| Q13 | Sales rate authority | Propose only | Section 7 |
| Q14 | Account manager assignment | Manual | `Setting.autoAssignAccountManager = false` |
| Q15 | Hosting | Vercel + managed Postgres + R2; worker on Railway or a VPS | ADR-001 |
| Q16 | Post-deployment client features | Out of scope | — |
| Q17 | Languages | English only | — |
| Q18 | Data protection | Retention setting + soft delete + anonymisation job; periods to confirm | Phase 5 |

## Phase 0 deviations from the master prompt

- **Postgres 17, not 16, for local development.** The machine has no Docker. Local dev and tests use real Postgres binaries via `embedded-postgres` (17.x). Docker Compose and CI still pin `postgres:16`. Nothing in the schema is version-specific. See ADR-004.
- **Local disk storage and console email drivers** exist alongside the S3 and SMTP adapters, because MinIO and Mailpit need Docker. Production uses S3 and SMTP.
- **Password hashing deferred to Phase 1** together with Auth.js. Seeded staff users have no password yet.
