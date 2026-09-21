import { describe, expect, it } from "vitest";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { AGENT_PROFILE_TRANSITIONS, assertTransitionAllowed, findTransition, IllegalTransitionError, isClientVisible, type AgentProfileStatus } from "@/server/state/agent-profile";

const STATUSES: AgentProfileStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REVISION_REQUIRED", "REJECTED", "HIDDEN", "SUSPENDED"];

describe("AgentProfile state machine (Section 5.1)", () => {
  it("every listed transition resolves", () => {
    for (const t of AGENT_PROFILE_TRANSITIONS) expect(findTransition(t.from, t.to)).toBe(t);
  });

  it("every unlisted pair throws IllegalTransitionError", () => {
    const listed = new Set(AGENT_PROFILE_TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    let checked = 0;
    for (const from of STATUSES) for (const to of STATUSES) {
      if (listed.has(`${from}>${to}`)) continue;
      expect(() => findTransition(from, to), `${from} → ${to}`).toThrow(IllegalTransitionError);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("only the owning agent can submit", () => {
    const owner = makeActor("AGENT", { agentProfileId: "p1" });
    const other = makeActor("AGENT", { agentProfileId: "p2" });
    expect(() => assertTransitionAllowed(owner, "p1", "DRAFT", "SUBMITTED")).not.toThrow();
    expect(() => assertTransitionAllowed(other, "p1", "DRAFT", "SUBMITTED")).toThrow(ForbiddenError);
    expect(() => assertTransitionAllowed(makeActor("ADMIN"), "p1", "DRAFT", "SUBMITTED")).toThrow(ForbiddenError);
  });

  it("recruiters review and request revisions but cannot approve; admins approve", () => {
    const recruiter = makeActor("RECRUITER");
    expect(() => assertTransitionAllowed(recruiter, "p1", "SUBMITTED", "UNDER_REVIEW")).not.toThrow();
    expect(() => assertTransitionAllowed(recruiter, "p1", "UNDER_REVIEW", "REVISION_REQUIRED", "Add a video")).not.toThrow();
    expect(() => assertTransitionAllowed(recruiter, "p1", "UNDER_REVIEW", "APPROVED")).toThrow(ForbiddenError);
    expect(() => assertTransitionAllowed(makeActor("ADMIN"), "p1", "UNDER_REVIEW", "APPROVED")).not.toThrow();
    expect(() => assertTransitionAllowed(makeActor("SALES"), "p1", "UNDER_REVIEW", "APPROVED")).toThrow(ForbiddenError);
  });

  it("revision, rejection, and suspension require a reason", () => {
    expect(() => assertTransitionAllowed(makeActor("ADMIN"), "p1", "UNDER_REVIEW", "REJECTED")).toThrow(/reason/i);
    expect(() => assertTransitionAllowed(makeActor("ADMIN"), "p1", "APPROVED", "SUSPENDED", "  ")).toThrow(/reason/i);
    expect(() => assertTransitionAllowed(makeActor("ADMIN"), "p1", "APPROVED", "SUSPENDED", "Policy violation")).not.toThrow();
  });

  it("only APPROVED is client-visible", () => {
    for (const s of STATUSES) expect(isClientVisible(s)).toBe(s === "APPROVED");
  });
});
