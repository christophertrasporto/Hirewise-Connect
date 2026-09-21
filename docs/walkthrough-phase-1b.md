# Phase 1B walkthrough — Media review, talent search, candidate profiles, shortlists

Date: 2026-09-21. Completes Phase 1 of MASTER_PROMPT.md together with `walkthrough-phase-1a.md`.

## What was built

| Area | Where | Notes |
|---|---|---|
| Media review queue | `/staff/media`, `media.service.ts` | Recruiters and Admins approve, request revision, or reject videos and voice samples. Rejection and revision require feedback, which the agent receives as a notification and email. Approving a video retires the previously approved one, so one intro is current. |
| Talent search | `/talent`, `search.service.ts` | Section 8.3 filters: text, role, skills, software, industry, experience level, availability, work setup, languages, minimum verification level, campaign experience, timezone overlap. Default sort: verification level, then availability, then approval recency. Shareable GET URLs. |
| Marketplace gate | `assertMarketplaceAccess` | Only ACTIVE clients (and staff with `agent.read_public`) may search or open candidates (Section 14 Q2, GATED). |
| Candidate profile | `/talent/[id]` | Client-safe projection: approved media only, no contact details, no review feedback, "rate set by Hirewise". Opening a profile records a `CandidateView` and an `Introduction`. |
| Shortlist | `/shortlist`, `/shortlist/compare` | Add, remove, private notes, compare up to four side by side. Adding is audited and notifies the account manager (one digest per client per day). |
| Shortlist activity | `/staff/shortlists` | Sales sees clients they manage; Admin and Operations see all. |
| Internal notes | `/staff/talent/[id]` | `AdminNote` with INTERNAL default; agents see only notes explicitly marked for them (INV-P4). |
| Client dashboard | `/dashboard` | Recommended candidates (matched to the services requested at registration), recently viewed, shortlist count, placeholders for interviews and placements. |
| Ownership rule | `policies/ownership.ts` | Sales reps act on assigned clients only, regardless of catalog permissions; Admin and Operations use `shortlist.read_all`. |
| Schema | migration `marketplace_shortlists_notes` | `Shortlist`, `ShortlistCandidate` (partial unique index on active membership), `CandidateView`, `Introduction`, `AdminNote`. |
| End-to-end tests | `e2e/isolation.spec.ts`, `playwright.config.ts` | Real browser: unauthenticated redirects, client A cannot see client B's shortlist, draft agents never appear for clients, search → profile → shortlist → compare, agents cannot reach the marketplace. |

## Demo script

1. `npm run db:seed` adds three approved agents (`jose@`, `ana@`, `carlo@talent.example`) and a second active client, Beta Corp, with a shortlist.
2. **Client:** log in as `hiring@acme-solar.example` → Find talent. Jose and Ana appear; Carlo is placed and hidden by the default availability filter (tick "Placed" to include him). Open Jose, shortlist him, add a note, then Compare.
3. **Sales:** log in as `sales@hirewise.example` → Shortlist activity shows Acme's shortlist (Acme is assigned to this rep); Beta Corp's is not shown because it is unassigned.
4. **Recruiter:** upload a video as `maria@talent.example`, then log in as `recruiter@hirewise.example` → Media review → approve. Maria's dashboard shows the approval.
5. **Isolation:** `npm run test:e2e` (dev server and seeded DB running).

## Acceptance criteria (Section 13, Phase 1)

| Criterion | Status |
|---|---|
| All Section 12 test categories for every Phase 1 service | Unit, projection, state machine, integration (auth, agreements, client, agent, media, search, shortlist, notes): 95 tests. |
| A client cannot fetch another client's shortlist by id (e2e) | `getShortlistForStaff` returns 404 for another client (integration) and the Playwright test proves it through the UI. |
| An agent's API responses never contain a `ClientBillingRate` amount | Rates arrive in Phase 4; the forbidden-key list already blocks the field names. |
| Unapproved media unreachable by clients, including by URL guessing | Signed URLs are issued only after an authorization check; clients get 404 on non-approved media (integration). Local signed URLs expire in 10 minutes and are HMAC-bound to method and key. |
| Agreement gating blocks every authenticated route until acceptance (e2e) | Layout-level gate; seeded approved agents without acceptances were correctly redirected during e2e development, which is why the seed now records acceptances for them. |

## Known limits carried into Phase 2

- Text search is `ILIKE` on headline, summary, and name rather than `tsvector`. Fine below a few thousand profiles.
- Timezone overlap is computed in memory on a capped result set (200 rows). Replace with a stored UTC offset column if the pool grows.
- "Request interview" on the candidate page is disabled until Phase 2.
- Certifications, assessments, and rates on cards and in the comparison table are placeholders until Phases 3 and 4.
