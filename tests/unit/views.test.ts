import { describe, expect, it } from "vitest";
import { toCandidateClientView, toAgentSelfView } from "@/server/views/agent.views";
import { toClientSelfView } from "@/server/views/client.views";
import { FORBIDDEN_FOR_CLIENT, FORBIDDEN_FOR_AGENT, collectKeys } from "@/server/views/forbidden-keys";

/** A fully populated record with every sensitive field present. */
function agentFixture() {
  const now = new Date();
  return {
    id: "a1", userId: "u1", displayName: "Maria S.", headline: "H", primaryRole: "Setter", summary: "S", photoKey: "k", yearsExperience: 4, experienceLevel: "MID" as const,
    locationCity: "Cebu", locationCountry: "PH", timezone: "Asia/Manila", languages: ["en"], workSetup: "REMOTE" as const, preferredShift: "US", equipmentSummary: "e", internetSummary: "i",
    status: "APPROVED" as const, verificationLevel: "PROFILE_VERIFIED" as const, availabilityStatus: "AVAILABLE" as const, availableFrom: null, profileCompletion: 90,
    submittedAt: now, approvedAt: now, approvedById: "admin", hiddenAt: null, suspendedAt: null, deletedAt: null, createdAt: now, updatedAt: now,
    privateContact: { id: "pc", agentProfileId: "a1", fullLegalName: "Maria Santos", personalEmail: "m@x.com", phone: "+63", addressLine: "Street 1", resumeKey: "r", governmentIdRefs: { passport: "x" }, createdAt: now, updatedAt: now },
    skills: [{ agentProfileId: "a1", skillId: "s1", level: "ADVANCED" as const, yearsUsed: 4, verifiedById: null, createdAt: now, updatedAt: now, skill: { id: "s1", name: "Cold Calling", category: "Sales", isActive: true, createdAt: now } }],
    experiences: [{ id: "e1", agentProfileId: "a1", company: "Acme", title: "Setter", industry: "Solar", startDate: now, endDate: null, description: "d", isCampaign: true, campaignType: "solar", createdAt: now, updatedAt: now }],
    industryExperiences: [{ id: "i1", agentProfileId: "a1", industry: "Solar", years: 2 }],
    softwareExperiences: [{ agentProfileId: "a1", softwareId: "sw1", level: "EXPERT" as const, software: { id: "sw1", name: "HubSpot", category: "CRM", isActive: true, createdAt: now } }],
    videos: [
      { id: "v1", agentProfileId: "a1", kind: "INTRODUCTION" as const, storageKey: "agents/a1/video/x.mp4", durationSec: 90, status: "APPROVED" as const, isCurrent: true, submittedAt: now, reviewedById: "r", reviewedAt: now, reviewFeedback: "internal note", createdAt: now, updatedAt: now },
      { id: "v2", agentProfileId: "a1", kind: "INTRODUCTION" as const, storageKey: "agents/a1/video/y.mp4", durationSec: 80, status: "REJECTED" as const, isCurrent: false, submittedAt: now, reviewedById: "r", reviewedAt: now, reviewFeedback: "too dark", createdAt: now, updatedAt: now },
    ],
    recordings: [{ id: "r1", agentProfileId: "a1", kind: "COLD_CALL" as const, title: "Solar", storageKey: "agents/a1/recording/x.mp3", durationSec: 60, status: "SUBMITTED" as const, submittedAt: now, reviewedById: null, reviewedAt: null, reviewFeedback: null, createdAt: now, updatedAt: now }],
    portfolioItems: [],
  };
}

describe("client-facing candidate projection (INV-A3, INV-P1)", () => {
  const view = toCandidateClientView(agentFixture());
  const keys = collectKeys(view);

  it("contains none of the forbidden keys", () => {
    for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), `forbidden key present: ${k}`).toBe(false);
  });

  it("exposes only APPROVED media and no storage keys", () => {
    expect(view.videos.map((v) => v.id)).toEqual(["v1"]);
    expect(view.recordings).toEqual([]);
    expect(keys.has("storageKey")).toBe(false);
  });

  it("does not expose the city, only country and timezone", () => {
    expect(keys.has("locationCity")).toBe(false);
    expect(view.locationCountry).toBe("PH");
  });
});

describe("agent self projection", () => {
  it("includes private contact for the owner but never the résumé storage key or ID refs", () => {
    const view = toAgentSelfView(agentFixture());
    expect(view.privateContact?.fullLegalName).toBe("Maria Santos");
    expect(view.privateContact?.hasResume).toBe(true);
    const keys = collectKeys(view);
    expect(keys.has("resumeKey")).toBe(false);
    expect(keys.has("governmentIdRefs")).toBe(false);
    expect(keys.has("storageKey")).toBe(false);
  });
});

describe("client self projection", () => {
  it("never leaks staff-only fields to the client", () => {
    const now = new Date();
    const view = toClientSelfView({
      id: "c1", companyName: "Acme", industry: "Solar", website: null, country: "US", timezone: "PST", status: "ACTIVE", accountManagerUserId: "sales1", source: "seed", deletedAt: null, createdAt: now, updatedAt: now,
      contacts: [{ id: "ct", clientId: "c1", userId: "u", name: "J", position: "P", businessEmail: "j@acme.com", phone: "+1", isPrimary: true, createdAt: now, updatedAt: now }],
      onboarding: null,
      accountManager: { id: "sales1", email: "sales@hirewise.example" },
    });
    const keys = collectKeys(view);
    expect(keys.has("accountManagerUserId")).toBe(false);
    expect(keys.has("accountManager")).toBe(false);
    expect(view.accountManagerAssigned).toBe(true);
  });
});

describe("forbidden key lists", () => {
  it("agent list forbids client financial and contact fields", () => {
    expect(FORBIDDEN_FOR_AGENT).toContain("budgetMax");
    expect(FORBIDDEN_FOR_AGENT).toContain("businessEmail");
  });
});
