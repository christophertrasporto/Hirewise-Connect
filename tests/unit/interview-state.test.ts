import { describe, expect, it } from "vitest";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { assertRequestTransition, IllegalTransitionError, DISCLOSE_COMPANY_FROM } from "@/server/state/interview-request";

const req = (status: Parameters<typeof assertRequestTransition>[1]["status"]) => ({ status, clientId: "client_a" });

describe("InterviewRequest state machine (Section 5.4)", () => {
  it("follows the linear path with the right actors", () => {
    const sales = makeActor("SALES");
    const client = makeActor("CLIENT", { clientId: "client_a" });
    expect(() => assertRequestTransition(sales, req("REQUESTED"), "SALES_REVIEW")).not.toThrow();
    expect(() => assertRequestTransition(sales, req("SALES_REVIEW"), "CLIENT_CONFIRMATION")).not.toThrow();
    expect(() => assertRequestTransition(client, req("CLIENT_CONFIRMATION"), "CANDIDATE_CONFIRMATION")).not.toThrow();
    expect(() => assertRequestTransition(sales, req("CANDIDATE_CONFIRMATION"), "SCHEDULED")).not.toThrow();
    expect(() => assertRequestTransition(sales, req("SCHEDULED"), "COMPLETED", undefined, true)).not.toThrow();
  });

  it("refuses skipped steps and wrong actors", () => {
    expect(() => assertRequestTransition(makeActor("SALES"), req("REQUESTED"), "SCHEDULED")).toThrow(IllegalTransitionError);
    expect(() => assertRequestTransition(makeActor("CLIENT", { clientId: "client_a" }), req("REQUESTED"), "SALES_REVIEW")).toThrow(ForbiddenError);
    expect(() => assertRequestTransition(makeActor("CLIENT", { clientId: "client_b" }), req("CLIENT_CONFIRMATION"), "CANDIDATE_CONFIRMATION")).toThrow(ForbiddenError);
    expect(() => assertRequestTransition(makeActor("RECRUITER"), req("CANDIDATE_CONFIRMATION"), "SCHEDULED")).toThrow(ForbiddenError);
    // System-only transitions cannot be triggered by a user directly.
    expect(() => assertRequestTransition(makeActor("SALES"), req("SCHEDULED"), "COMPLETED")).toThrow(ForbiddenError);
  });

  it("cancellation needs a reason and is impossible after completion", () => {
    expect(() => assertRequestTransition(makeActor("CLIENT", { clientId: "client_a" }), req("SCHEDULED"), "CANCELLED")).toThrow(/reason/i);
    expect(() => assertRequestTransition(makeActor("CLIENT", { clientId: "client_a" }), req("SCHEDULED"), "CANCELLED", "Role filled internally")).not.toThrow();
    expect(() => assertRequestTransition(makeActor("SALES"), req("COMPLETED"), "CANCELLED", "x")).toThrow(IllegalTransitionError);
  });

  it("company disclosure starts at SCHEDULED", () => {
    expect(DISCLOSE_COMPANY_FROM).toEqual(["SCHEDULED", "COMPLETED", "CLIENT_DECISION_PENDING", "CLOSED"]);
  });
});
