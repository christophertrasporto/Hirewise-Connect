# Phase 5 walkthrough — Advanced

Date: 2026-09-23. Implements MASTER_PROMPT.md Phase 5: rule-based matching with explanations, analytics dashboard, client portal enhancements (saved searches, requirement-to-match view), in-browser video and voice recording, Stripe adapter, calendar and Zoom link integration, SMS channel adapter, incident management, bulk admin actions, client data export, plus the Section 14 Q18 data-protection tooling and the remaining Section 8.8 flag rules.

## What was built

| Area | Where | Notes |
|---|---|---|
| Rule-based matching | `match.service.ts`, `/requirements/[id]`, `/staff/requirements/[id]` | `matchCandidates(requirementId)` applies hard rules (role, required skills, availability unless "available soon" is included) and weighted soft rules (skills coverage, industry, experience level, certifications, timezone overlap, published rate within budget, assessment rank; software is reported but unweighted). Weights live in `Setting.matchWeights`. Every result lists matched and unmatched reasons with points, and ordering is deterministic (score, approval date, id). Near misses are shown with the failing hard rule. No ML (INV-C6). |
| Saved searches | `SavedSearch`, `saved-search.service.ts`, chips on `/talent` | Clients name the current filter set; running it rewrites the marketplace URL. Own client only. |
| Analytics dashboard | `analytics.service.ts`, `/staff/analytics` | Section 11 blocks gated per role: talent registrations, approval rate, median time-to-approval; clients by source and status; available talent by role, skill, certification, industry, timezone; certification completion by course and coach (coaches see their own); hiring funnel with average days to placement; compliance counters. CSS bar charts, no chart library. |
| In-browser recording | `Recorder.tsx` on `/profile/media` | MediaRecorder produces WebM video or audio that goes through the existing presigned upload and confirm flow, then Hirewise review. Falls back to file upload when unsupported. |
| Stripe adapter | `adapters/payments.ts`, `/api/webhooks/stripe`, `/api/payments/fake/[invoiceId]` | `PaymentProvider` now has manual, fake, and Stripe implementations. Stripe Checkout Sessions are created through the REST API; the webhook verifies the `Stripe-Signature` HMAC and records the payment through the same settlement path as manual recording, idempotent on the provider reference. The fake provider pays through a dev-only route (refused in production). Clients see a "Pay online" button on open invoices when a provider is configured. |
| Meeting links | `adapters/meetings.ts` | `MeetingProvider` with none (Sales pastes a link, Q10), fake (deterministic local link), and Zoom (Server-to-Server OAuth). When Sales schedules without a link and a provider is configured, a meeting is created and audited. |
| Calendar | `lib/ics.ts`, `/api/calendar/interviews/[id].ics` | "Add to calendar" on client, agent, and staff interview pages; scoped to participants. Google Calendar template URLs are available from the same helper. |
| SMS channel | `adapters/sms.ts`, `SEND_SMS` job, `NotificationPreference.sms` | `NotificationChannel` implementation with console and Twilio drivers. Opt-in per notification type; interview reminders to agents use the private-contact phone. |
| Incidents | `Incident`, `incident.service.ts`, `/staff/compliance/incidents`, `/[id]` | Section 4.8 model created. Admin and Sales create incidents (Sales see only their own, footnote 11), attach evidence documents (private storage, signed URLs), move OPEN → UNDER_REVIEW → RESOLVED or DISMISSED with a resolution note, suspend the subject user with a reason (sessions dropped, profile leaves the marketplace), reinstate, and view history per user. Flags link to "Open incident". |
| Remaining Section 8.8 flags | `search.service.ts`, `shortlist.service.ts`, `agent.service.ts` | PROFILE_VIEW_BURST (views per hour over `Setting.profileViewBurstPerHour`), SHORTLIST_CHURN (adds plus removals per day over `Setting.shortlistChurnPerDay`), CONTACT_INFO_IN_PROFILE (message filter applied to headline, summary, experience text). One flag per window. |
| Bulk admin actions | `admin.service.ts`, `/staff/talent` | Select agents and hide, unhide, set availability, set verification, or notify. Each item runs through the single-item service so guards and audit rows are identical; failures are reported per agent. Role broadcasts from `/staff/users`. |
| Client data export | `export.service.ts`, `/api/export/client`, button on `/company` | JSON of everything the client can already see: company, requirements, shortlists, interview requests with released messages, placements with rate snapshot and deposit, invoices and payments, agreement acceptances, saved searches. Audited. |
| Data protection (Q18) | `admin.service.ts`, `/staff/users`, `/staff/compliance/data` | `anonymiseUser` scrubs email, credentials, MFA, private contact, free text, media, and messages while keeping commercial and audit rows; refused while a placement is open. `runRetention` anonymises accounts inactive beyond `Setting.retentionDays` (default 730). Both need `user.manage` and a reason. |
| Schema | migration `incidents_saved_searches_integrations` | `Incident` (+ enums), `SavedSearch`, `NotificationPreference.sms`, `Interview.meetingProvider/meetingExternalId`, `Invoice.providerCheckoutId`. |
| Environment | `.env.example` | `PAYMENT_PROVIDER`, `STRIPE_*`, `MEETING_PROVIDER`, `ZOOM_*`, `SMS_DRIVER`, `TWILIO_*`. Local `.env` uses the fakes. |

## Acceptance criteria (Section 13, Phase 5)

| Criterion | Evidence |
|---|---|
| Match results carry human-readable reasons and are deterministic for a fixed dataset | `tests/unit/phase5.test.ts` pins scores and reason texts for a fixed candidate; `tests/integration/phase5.test.ts` runs the same requirement twice and compares order, checks hard rules, near misses, owner scoping, and the include-soon switch. |
| Each integration sits behind its adapter interface with a local fake | Payments: manual, fake, Stripe (signature verification tested, tampering and stale timestamps rejected). Meetings: none, fake, Zoom. SMS: console, Twilio. Integration test schedules with the fake meeting provider, sends an SMS through the console channel, and settles a deposit through the fake checkout. |

## Demo script

1. `npm run db:seed` (adds the match weights and Section 8.8 thresholds to settings). `.env` sets `PAYMENT_PROVIDER=fake` and `MEETING_PROVIDER=fake`.
2. **Client** `hiring@acme-solar.example`: Requirements → open a requirement → matches with reasons → "Interview top 3". Find talent → apply filters → "Save this search as…". Company → Export my data.
3. **Client**: Billing → an open invoice → Pay online (fake checkout) → back on the invoice with "Payment received"; the placement moves to deployment prep.
4. **Sales** `sales@hirewise.example`: schedule an interview without pasting a link → a meeting link appears; "Add to calendar" downloads the .ics.
5. **Talent** `jose@talent.example`: Video & voice → "Record in the browser".
6. **Admin** `admin@hirewise.example` (MFA): Compliance → flags → Open incident → attach evidence → suspend → reinstate → resolve. Users → search → anonymise on request. Compliance → Data protection → run retention. Talent → select several → bulk action. Analytics.

## Known limits carried forward

- Stripe and Zoom adapters are implemented against their REST APIs but were verified only through the local fakes and signature tests; point `STRIPE_*`/`ZOOM_*` at test accounts before launch.
- SMS is opt-in per notification type; there is no preferences UI yet, so preferences are set by staff or seed.
- Retention is admin-run, not scheduled; the worker can call `runRetention` on a cron once the retention periods are confirmed with counsel (Q18).
- Seed volume stays at the demo set (not the 25-agent dataset from Section 12).
