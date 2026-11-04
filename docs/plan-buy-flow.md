# Buy flow and short sign-up (Public Academy part 3)

Requested 2026-11-05, approved the same day (all six decisions as recommended). No migration.

## Why

Buying meant: Buy course, a ten-field sign-up, verify email, land on the course page, press Enrol, then press a pay button. This shortens it to: Buy course, a four-field sign-up, verify email, then one checkout screen with one press.

## Decisions

1. `/courses/<id>/buy` is a checkout screen, not a link that acts on a plain GET (a crawler or prefetch must not enrol anyone or start a payment). One button press enrols and starts the chosen payment.
2. The short sign-up is used only on the buy path (`/register/talent?quick=1`, reached from the Buy button). The full "Apply as talent" form is unchanged.
3. The short form asks for full name, email, password and the terms. The professional name starts as first name and last initial ("Maria S."); city, timezone, role and experience are completed on the profile page. The profile stays a DRAFT.
4. The welcome-video lock keeps its rule (enrolling is refused until the Admin's welcome video is watched). A locked buyer sees a clear message with a button to the video instead of an error.
5. The return-to-course cookie gains exactly one extra destination, `/courses/<id>/buy`. No free-form `next`.
6. Rollout: no migration, no env change; it takes effect when the public Buy button points at the new screen (this PR).

## Build

- `src/lib/return-to.ts`: `safeReturnPath` accepts the buy path; `startReturnHref(id, next, "buy")`; `isBuyReturnPath`.
- `/api/return/start`: a buy destination sends a new visitor to the short sign-up.
- `agent.service.ts`: `registerAgent` takes optional profile fields; `registerAgentQuick` and `quickAgentRegistrationSchema`; `registerAgentQuickAction`; `AgentQuickRegisterForm`.
- `purchase.service.ts` (`startPurchase`) and `purchase-actions.ts`; the checkout page and `PurchaseForm` (promo code, Maya, PayPal, or offline).
- `course-cta.ts`: the public Buy button points signed-out visitors at the short sign-up and signed-in talent at checkout.
- Maya's learner-facing errors became `UserMessageError` so the screen can show them.
