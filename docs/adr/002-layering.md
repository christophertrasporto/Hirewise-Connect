# ADR-002: Layering and the Prisma import boundary

**Status:** Accepted, 2026-09-21

## Context

The platform's business rules are security rules: which fields a role may see, who may change a rate, when a placement may activate. If those checks live in route handlers or UI components they get bypassed by the next route that forgets them (MASTER_PROMPT.md Section 1.3).

## Decision

Four layers, enforced by tooling:

1. **Routes and server actions** (`src/app`) are thin. They build an `Actor` from the session and call one service function.
2. **Services** (`src/server/services`) own business logic. Every function takes an `Actor` first and calls `authorize()` or an ownership assertion before any read or write. Writes happen inside `db.$transaction` together with `audit()` and `publishEvent()`.
3. **Repositories** (`src/server/repositories`) own Prisma queries. They are the only modules, with `src/server/db`, allowed to import `@prisma/client` or the client instance. An ESLint rule (`@typescript-eslint/no-restricted-imports`) enforces this and `tests/lint/prisma-boundary.test.ts` proves the rule works.
4. **Views** (`src/server/views`, Phase 1) are explicit allowlist projections per role. Spreading a database record into a response is forbidden. Each view has a test asserting forbidden keys are absent.

Other modules name a transaction through the type-only module `@/server/db/types`. The entry layer (pages, server actions, route handlers, and the request gate) may import the client handle from `@/server/db/client` only to pass it into a service; services take the database as a parameter so tests can run them against a throwaway instance.

Cross-tenant access by a CLIENT raises `NotFoundError`, not `ForbiddenError`, so a client cannot probe for other clients' record ids.

## Consequences

- Authorization is auditable by grepping services for `authorize(`.
- Repositories stay dumb, which keeps ownership scoping (`clientId` from the Actor, never from input) in one place.
- Slight ceremony for simple reads. Accepted: the ceremony is the control.
