import { describe, expect, it } from "vitest";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertAgentOwns, assertClientOwns, assertCoachAssigned, scopedClientId } from "@/server/policies/ownership";

describe("assertClientOwns (INV-P3)", () => {
  const clientA = makeActor("CLIENT", { clientId: "client_a" });

  it("passes for the owning client", () => {
    expect(() => assertClientOwns(clientA, { clientId: "client_a" })).not.toThrow();
  });

  it("raises NotFound, not Forbidden, for another client's record (no existence leak)", () => {
    expect(() => assertClientOwns(clientA, { clientId: "client_b" })).toThrow(NotFoundError);
  });

  it("raises NotFound for a missing record", () => {
    expect(() => assertClientOwns(clientA, null)).toThrow(NotFoundError);
  });

  it("lets staff through only with the named permission", () => {
    expect(() => assertClientOwns(makeActor("ADMIN"), { clientId: "client_b" }, "shortlist.read_all")).not.toThrow();
    expect(() => assertClientOwns(makeActor("COACH"), { clientId: "client_b" }, "shortlist.read_all")).toThrow(ForbiddenError);
  });

  it("lets SALES through for assigned clients only", () => {
    const rep = makeActor("SALES", { salesAssignedClientIds: ["client_a"] });
    expect(() => assertClientOwns(rep, { clientId: "client_a" })).not.toThrow();
    expect(() => assertClientOwns(rep, { clientId: "client_b" })).toThrow(ForbiddenError);
  });
});

describe("assertAgentOwns", () => {
  const agent = makeActor("AGENT", { agentProfileId: "agent_1" });

  it("passes for own profile and hides others", () => {
    expect(() => assertAgentOwns(agent, { agentProfileId: "agent_1" })).not.toThrow();
    expect(() => assertAgentOwns(agent, { agentProfileId: "agent_2" })).toThrow(NotFoundError);
  });

  it("client actors never pass an agent ownership check", () => {
    expect(() => assertAgentOwns(makeActor("CLIENT", { clientId: "c" }), { agentProfileId: "agent_1" })).toThrow(ForbiddenError);
  });
});

describe("assertCoachAssigned (INV-P5)", () => {
  it("coach sees assigned course only", () => {
    const coach = makeActor("COACH", { coachCourseIds: ["course_1"] });
    expect(() => assertCoachAssigned(coach, "course_1")).not.toThrow();
    expect(() => assertCoachAssigned(coach, "course_2")).toThrow(NotFoundError);
  });
});

describe("scopedClientId", () => {
  it("ignores the requested id for CLIENT actors", () => {
    const clientA = makeActor("CLIENT", { clientId: "client_a" });
    expect(scopedClientId(clientA, "client_b", "client.read")).toBe("client_a");
  });

  it("requires a permission for staff", () => {
    expect(scopedClientId(makeActor("ADMIN"), "client_b", "client.read")).toBe("client_b");
    expect(() => scopedClientId(makeActor("RECRUITER"), "client_b", "client.read")).toThrow(ForbiddenError);
  });
});
