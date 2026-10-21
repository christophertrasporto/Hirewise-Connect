# Agency platform v2, phase 6b: opportunities, submissions, and dashboards

Second half of phase 6 (plan and approved decisions 5 to 8: `docs/plan-agency-communication-phase6.md`). This half delivers the opportunity and submission flow that the earlier A4 and A5 specs never built, the exit action that withdraws submissions, the agency Opportunities and Reports tabs, the client Opportunities pages, the staff submissions queue, and the Partner Team performance rating. With it, every feature of the v2 spec has a home.

## What changed

| Area | Delivered |
| --- | --- |
| Opportunities | `Opportunity` published by Hirewise (`opportunity.manage`) from a `ClientRequirement` (one per requirement): title, role summary, skills, software, schedule, headcount, and `maskedClientLabel` built with the phase 5 masking ("Healthcare client, United States"). Visibility `ALL_AGENCIES` (every active agency plus direct talent), `SELECTED_AGENCIES` (`OpportunityAgency` rows), or `DIRECT_ONLY`. Publishing moves the requirement to IN_PROGRESS; Filled marks it FILLED; closing withdraws pending and approved submissions. |
| Submissions | `Submission` by an agency owner or manager with `agency.submissions.create` for an active member, or by Hirewise Direct and independent talent for themselves. Eligibility (decision 6): approved profile, availability AVAILABLE or AVAILABLE_SOON, an active certification or final assessment when `opportunities.requireActiveCredentials` is on, no open submission for the same opportunity, and at most `opportunities.maxSubmissionsPerAgency` open per agency and opportunity. Exclusivity: an agent with an open membership is refused when self-submitting; agency B cannot submit agency A's member; selected-agency and direct-only visibility are enforced server-side. Hirewise reviews (approve or decline with a note); submitters may withdraw pending or approved submissions. |
| Clients | `/opportunities` lists the client's own opportunities with counts; the detail page shows approved candidates as client-safe cards (phase 5 labels, Partner Team line, client-safe media) and a Request interviews form that creates the interview request directly from the opportunity (no shortlist needed), marks the submissions INTERVIEWING, and opens the mediated thread. Selection and rejection in the existing decision flow move the submission to SELECTED or NOT_SELECTED. |
| Exit | `withdrawSubmissionsOnExit` runs in the `AGENCY_EXIT_COMPLETED` handler after the credential revocation: the agency's open submissions for the leaving agent become WITHDRAWN with the reason and Hirewise is notified. Decided submissions are history and stay. |
| Agency portal | Opportunities: open roles with the masked client, the agency's own submissions only, eligible members with the reason when not eligible, submit and withdraw. Reports: team, training, submissions, interviews, placements, all bounded by the agency id (`agency-report.service.ts`). Overview tiles for in training, open opportunities, and active placements are live. |
| Talent | `/opportunities`: direct and independent talent browse and apply through Hirewise; agency agents see what their agency put them forward for and the status. |
| Staff | Opportunities: publish from a requirement (also linked from the requirement page), filters, detail with submissions, approve or decline, withdraw approved, mark filled or close. Dashboard counts submissions to review. |
| Partner Team rating | `performanceRating` = placements that reached ACTIVE or COMPLETED divided by selected submissions, shown only from five selected submissions (decision 7). |
| Permission | `opportunity.manage` for ADMIN and SALES (decision 8). |

## Where the rules are enforced

- `submitAgent` holds every eligibility and exclusivity rule; `listOpportunitiesForAgency` only explains them.
- Tenant scope: `listOpportunitiesForAgency` and `agencySubmissions` go through `requireActiveAgency` and `assertAgencyScope`; the agency view filters submissions to the agency's own; `agencyReport` uses `scopedAgencyId`.
- Client scope: `getOpportunityForClient` and `requestInterviewsFromOpportunity` compare the opportunity's client with the actor's; other clients get NotFound.
- Clients receive candidates only through `toCandidateCardView` with the CLIENT audience and client-safe context; the opportunity views carry the Partner Team identity, never the agency.

## Migration

`20261021090000_opportunities_schema` (Opportunity, OpportunityAgency, Submission, three enums; `OpportunitySubmissionStatus` because `SubmissionStatus` already names course assignment states). Additive, no data step. Setting `opportunities`. Production needs `npm run db:deploy`.

## Tests

`tests/integration/opportunities.test.ts` (6 tests): publishing with the masked label, notifications to agency owners, agency and talent and client lists with leak and forbidden-key checks, selected-agency visibility; eligibility (credential, cap, duplicate), exclusivity (self-submit, other agency), staff notifications and tasks, tenant scope of submissions; review with notifications, client-safe candidates, decline notes, withdrawal; interview requests from the opportunity through scheduling and selection with the submission outcome, the agency report, rating thresholds; exit withdrawal; closing and filling.

## Next

The v2 spec is complete. Remaining launch items are the user's: counsel-approved terms text, retention periods, production credentials (Stripe, Zoom, SMTP, R2), plan and package prices, `S3_REGION=auto`, and enabling inbound email routing once the provider supports it.
