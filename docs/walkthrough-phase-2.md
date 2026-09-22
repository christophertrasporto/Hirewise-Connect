# Phase 2 walkthrough — Interviews

Date: 2026-09-22. Implements MASTER_PROMPT.md Phase 2: client requirements, interview requests (Section 5.4), Sales dashboard, mediated messaging with hold-for-review, scheduling and reminders, client decisions, placement records, and reservations with expiry.

## What was built

| Area | Where | Notes |
|---|---|---|
| Client requirements | `/requirements`, `requirement.service.ts` | Title, role, skills, software, industry, level, schedule, timezone, start date, optional budget (stored in minor units), free text. Linked to interview requests. |
| Interview requests | `/interviews/new`, `/interviews`, `/interviews/[id]`, `interview.service.ts` | Candidates must be on the client's active shortlist. Creating one writes `Introduction(INTERVIEW)`, audits, notifies the account manager (or the Sales queue), and creates a follow-up task. |
| State machine | `state/interview-request.ts` | REQUESTED → SALES_REVIEW → CLIENT_CONFIRMATION → CANDIDATE_CONFIRMATION → SCHEDULED → COMPLETED → CLIENT_DECISION_PENDING → CLOSED; CANCELLED from any pre-completion state with a reason. System-only transitions cannot be triggered by users. |
| Sales coordination | `/staff/interviews`, `/staff/interviews/[id]` | Start review (self-assign), propose times (mediated message), confirm on the client's behalf, schedule per candidate with timezone, duration, and link; record outcomes; sales notes; cancel. |
| Candidate side | `/interviews` (agent) | Anonymised until scheduling: role, schedule, timezone, start date. Confirm or decline availability. Company name appears at SCHEDULED (Section 6, footnote 9). |
| Mediated thread | `message.service.ts`, `lib/message-filter.ts` | Client and agent messages go to Hirewise (never to each other). Contact details → held for review + `ActivityFlag`; rate or direct-hire language → flagged. Sales releases or blocks held messages from `/staff/compliance`. Staff choose visibility per message. |
| Scheduling side effects | `scheduleInterviews` | Availability → INTERVIEWING, reminder jobs at 24 h and 1 h (`INTERVIEW_REMINDER`), notifications to client, candidate, and rep. Sales sees the candidate's legal name from SCHEDULED (footnote 1), never the email. |
| Client decisions | `recordClientDecision` | Interested / Second interview / Selected / Not selected per interview, only once all interviews are complete. SELECTED creates a `Placement` (SELECTED), reserves the candidate for the client, and notifies agent, rep, Admin, and Operations; a FINALISE_PLACEMENT task is created. SECOND_INTERVIEW re-opens scheduling. The request closes when every interview has a final decision and idle candidates return to AVAILABLE. |
| Placements | `/placements` (client, agent), `/staff/placements` | Read-only records at SELECTED. The commercial pipeline is Phase 4. |
| Reservations | `/staff/reservations`, reserve form on `/staff/talent/[id]`, `reservation.service.ts` | One active hold per agent; TTL from `Setting.reservationTtlDays`; extend and release; the worker expires due holds every ten minutes and restores the availability in force before the hold; the rep is warned 24 h before expiry. |
| Dashboards | Sales/staff, client, agent | New requests, awaiting client/candidates, upcoming 7 days, awaiting decision, selected, open requirements, held messages, open flags; client counters and upcoming interviews; agent request list with "please confirm" prompts. |
| Schema | migration `interviews_placements_flags` | `InterviewRequest`, `InterviewRequestCandidate`, `Interview`, `InterviewMessage`, `Placement`, `ActivityFlag`, plus enums. |

## Acceptance criteria (Section 13, Phase 2)

| Criterion | Evidence |
|---|---|
| Full flow demoed from request to SELECTED | `tests/integration/interviews.test.ts` runs the complete lifecycle including messages, scheduling, decisions, placement, and reservation. `e2e/interviews.spec.ts` drives it through the UI across client, candidate, and Sales sessions. |
| Agent never receives the client company name before SCHEDULED | Projection test (`toRequestAgentView` has no `client`, `notes`, or `salesNotes`; `companyName` null until SCHEDULED) plus the e2e assertion that "Acme" is absent from the candidate's pages before scheduling and present after. |
| A client message containing a phone number is held and flagged | Integration test and e2e: message held, `CONTACT_INFO_IN_MESSAGE` flag created, hidden from the candidate, visible on `/staff/compliance`, releasable by Sales. |
| Reservation auto-expires and restores availability (fake clock) | `expireReservations(db, now)` with an injected clock: not due → 0; after extension the earlier deadline no longer expires; past the extended deadline → expired, availability restored to the pre-hold status, rep notified. |

## Demo script

1. Seed and start (`npm run db:local`, `npm run dev`, `npm run worker`).
2. **Client** `hiring@acme-solar.example`: Find talent → Jose R. → Shortlist → Request interview → submit.
3. **Sales** `sales@hirewise.example`: Interview requests → Open → Start review → Send proposed times.
4. **Client**: Interviews → open → Confirm proposed times. Try sending a message with a phone number: it is held.
5. **Agent** `jose@talent.example`: Interviews → open (no company shown) → I am available.
6. **Sales**: Compliance shows the held message (release or block). Interview requests → Awaiting candidates → Open → set date/time and link → Schedule and notify.
7. **Agent**: the request now shows "Acme Solar" and the meeting link. **Sales**: after the interview, record the outcome. **Client**: record a decision. Selecting creates the placement and reserves Jose; Reservations shows the hold.
8. `npm run test:e2e` runs both specs.

## Known limits carried forward

- Meeting links are pasted by Sales (Section 14 Q10). Calendar and Zoom integrations are Phase 5.
- The Sales request queue is shared: any Sales rep can pick up an unassigned request. Ownership checks on clients remain assignment-based.
- Reminder jobs are enqueued at scheduling; rescheduling is done by cancelling and scheduling again (no in-place edit yet).
- Placement pipeline beyond SELECTED (approval, agreement, deposit, activation) is Phase 4.
