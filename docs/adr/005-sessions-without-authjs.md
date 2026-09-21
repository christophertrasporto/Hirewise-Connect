# ADR-005: Database sessions implemented directly instead of Auth.js

**Status:** Accepted, 2026-09-21. Supersedes the "Auth.js v5" line in ADR-001.

## Context

Phase 1 needs: email + password login with argon2id, magic-link login, email verification, password reset, database-backed sessions that can be revoked, and a mandatory TOTP second factor for Super Admin and Admin that is enforced *per session* (a session exists but is not admitted until the code is verified). Every request must build the `Actor` from the database (INV-A1), and the request gate must also enforce email verification and agreement acceptance (INV-I2).

Auth.js v5 fits OAuth-centric apps well. Its credentials provider defaults to stateless JWT sessions, its database-session mode does not model a "second factor pending" state, and the gate logic would have lived in callbacks outside our service layer. Getting the required behaviour meant fighting the library at every step the invariants care about.

## Decision

Implement authentication in `src/server/auth/*` and `src/server/services/auth.service.ts`:

- **Sessions** are rows in `Session`. The cookie holds a random 256-bit token; only its SHA-256 lives in the database. Sessions carry `mfaPassed`, IP, user agent, and expiry (12 hours, or 30 days with "keep me signed in"). Password reset revokes all sessions.
- **One-time tokens** (`AuthToken`) for magic link, email verification, and password reset are stored hashed with per-kind TTLs and single-use semantics enforced by an atomic update.
- **Passwords** use argon2id via `@node-rs/argon2` with OWASP parameters. Missing-account and wrong-password produce the same message and cost.
- **MFA** uses TOTP (`otpauth`); the secret is AES-256-GCM encrypted at rest with `AUTH_SECRET`. Enrolment is forced on first staff login.
- **Rate limiting** is an in-process sliding window on login, magic link, reset, verification, MFA, registration, and uploads.
- **The request gate** (`require-actor.ts`) resolves the actor once per request and orders the gates: MFA → email verification → agreements. Gate pages require only the earlier stages.

## Consequences

- About 400 lines we own and test, instead of configuration we do not control. All 72+ tests run against a real database.
- No OAuth providers today. Adding Google or Microsoft sign-in later means a small provider module that ends in `createSession()`, not a rewrite.
- Multi-instance deployments must move the rate limiter to Redis or a table; the interface is a single function.
- `DEV_EXPOSE_LINKS=true` (development only) returns emailed links to the UI so local testers can follow them without a mailbox.
