# ADR-003: Agent compensation and client billing rate are separate aggregates

**Status:** Accepted, 2026-09-21

## Context

Hirewise's margin is the difference between what a client is billed and what an agent is paid. Two of the six business problems in the master prompt (clients discussing rates with agents, agents setting their own client rates) come from these numbers leaking or being conflated.

## Decision

- Two tables: `ClientBillingRate` and `AgentCompensation` (Phase 4). No shared "rate" column anywhere, including on `Placement`, which stores a snapshot reference to each.
- Two permission groups: `billing_rate.*` and `compensation.*`. Only `SUPER_ADMIN` holds `compensation.read` by role. `ADMIN` gets it only through an audited `UserPermissionOverride`.
- Publishing a client rate requires `billing_rate.approve`. Sales may propose, never publish.
- Every change to either table writes a `RateHistory` row in the same transaction with previous value, new value, actor, reason, and timestamp.
- Agents never see the client billing amount, only whether one is published (Section 14, Q4).
- Money is stored as integer minor units with an ISO 4217 currency and a `RateUnit` (`HOURLY | MONTHLY`).
- No pricing algorithm. Admins set rates by judgement, with the factors listed in the master prompt recorded as `positioningNotes`.

## Consequences

- Reports that show margin require both permissions and are restricted accordingly.
- Client-facing projections can be tested for the absence of `AgentCompensation` fields because they never share a type with billing rate fields.
- Phase 0 already encodes the permission split so later phases cannot accidentally widen it.
