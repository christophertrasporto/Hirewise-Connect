# Agency platform v2, phase 6a: communication and enforcement

First half of phase 6 (plan and approved decisions 1 to 8: `docs/plan-agency-communication-phase6.md`, shipped as 6a and 6b per the scope answer). This half delivers mediated message threads with contact-detail masking, Hirewise-controlled interview links, email aliases, and bypass report cases. Opportunities, submissions, the exit withdrawal of submissions, agency and client dashboards, reports, and the Partner Team performance rating are phase 6b.

## What changed

| Area | Delivered |
| --- | --- |
| Threads | `MessageThread` (kinds `INTERVIEW_REQUEST`, `PARTNER_ENQUIRY`, `SUPPORT`; `OPPORTUNITY` and `SUBMISSION` reserved for 6b) and `Message`. Every interview request gets a thread at creation; existing requests and their `InterviewMessage` rows were migrated (same message ids, old table kept as history). Clients open a Partner Team enquiry from the team page (one open enquiry per client and team, the team's owner is in the thread), and clients, talent, and agency users can message Hirewise (`SUPPORT`). Participation is server-side: client contacts, the agent (or the request's candidates), the agency's portal users, and staff with `interview.read_all` or `thread.moderate`. Visibility per message: `CLIENT_AND_HIREWISE`, `AGENT_AND_HIREWISE`, `AGENCY_AND_HIREWISE` (new), `ALL`, `HIREWISE_ONLY`; nobody addresses the other side directly. |
| Masking | `messaging.contactDetails` setting: `MASK` (default, decision 1) delivers the message with emails, phones, links, handles, and agency names replaced by "[removed]", keeps the typed text on `originalBody` for staff, and raises a flag; `BLOCK` holds the message for Sales review as before. `scanMessage` now treats any link or bare domain as a contact route. Rate talk is flagged when `messaging.flagRateTalk` is on. Author labels follow phase 5: clients see the client label or the Partner Team name, talent and agencies see the masked client label unless a CLIENT_IDENTITY grant exists, staff see everything. |
| Interviews | `InterviewRequest.requestedWindows` (client-entered, one per line) and `Interview.participants` (labels only) and `linkSource`. `scheduleInterviews` refuses a pasted link whose host is not the configured provider's or on `meetings.allowedHosts` (decision 2) with a clear error, a `MEETING_LINK_REFUSED` flag, and an audit row; `meetings.requireProvider` forbids pasted links entirely. |
| Aliases | `EmailAlias` (`talent####@`, `team####@`, `client####@` on `email.aliasDomain`), allocated at first use and by the worker for every approved agent and active agency, backfilled by the migration. Client views show `contactAlias` on candidates and Partner Teams instead of any address. Inbound routing (decision 3): `POST /api/inbound/email` verifies an HMAC signature under `INBOUND_EMAIL_SECRET`, resolves the alias and the sender, and posts into the owner's support thread through the normal masking rules; it answers 503 while `email.inboundEnabled` is off. |
| Bypass reports | `BypassReport` with append-only `BypassReportEvent` history (trigger-protected). Clients, talent, agency users, and staff report from threads, candidate pages, Partner Team pages, and the Report a bypass attempt page; staff with `bypass.review` move the case Reported → Under review → Warning issued / Restricted / Suspended → Closed with a required decision note. Warning notifies the reported party; Restricted hides an agent's profile (and sets them unavailable), suspends a client, or suspends an agency with an end date recorded; Suspended uses the existing `suspendUser` path and needs `user.manage`; Closed may lift the restriction. Evidence attachments reuse the document store. A report never changes anything by itself (decision 4). |
| Staff | Compliance gains Bypass reports (list, filters, case page with decision, evidence, history) and a Masked messages card; the dashboard counts open bypass cases and documents awaiting client clearance; held-message counters read from the new table. |
| Permissions | `thread.moderate` and `bypass.review`, held by ADMIN and SALES (decision 8). |

## Where the rules are enforced

- `thread.service.participation` is the only access check for threads; `canSee` applies visibility and held or blocked state; `postToThread` applies masking or holding, flags, and audits; `message.service` is a wrapper that keeps the interview pages and tests on the same path.
- `assertMeetingLinkAllowed` runs before the scheduling transaction; the provider's link is always allowed, pasted links only on allowed hosts.
- Aliases are allocated only through `aliasFor`; real addresses never appear in client views (the phase 5 leak sweep now also checks `contactAlias`).
- `decideBypass` enforces the status machine, the note, the named party for sanctions, and `user.manage` for suspension; restrictions and lifts go through the agent, client, and agency repositories with audit rows.

## Migration

`20261019090000_communication_schema` and `20261019090001_communication_data` (threads and messages from interview requests, alias sequence and backfill, append-only trigger on case history). Settings `messaging`, `meetings`, `email`. Production needs `npm run db:deploy`; set `INBOUND_EMAIL_SECRET` only when inbound routing is enabled.

## Tests

`tests/integration/communication.test.ts` (9 tests): link and meeting-host detection; thread creation at request, masking with flags and the staff-only original, BLOCK mode with release and block, rate-talk flags, Partner Team enquiries with tenant scope, participation, labels, and the forbidden-key sweep, support threads, closing; refused and accepted meeting links, participants, `requireProvider`; alias allocation, idempotency, display on client views, inbound routing off and on with unknown alias and sender; bypass reporting by a client and an agent, staff notifications and task, reporter versus staff views, the status machine, restriction and lift, suspension permission, append-only history. The interview test keeps its held-message scenario under `BLOCK`.

## Next

Phase 6b: opportunities and submissions (publish from a requirement, eligibility, Hirewise review, client candidates and interview requests from opportunities, withdrawal on exit), agency Opportunities and Reports, client Opportunities, staff submissions queue, and the Partner Team performance rating.
