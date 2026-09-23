import { describe, expect, it } from "vitest";
import { scoreCandidate } from "@/server/services/match.service";
import { FakePaymentProvider, StripePaymentProvider, ManualPaymentProvider } from "@/server/adapters/payments";
import { FakeMeetingProvider, NoMeetingProvider } from "@/server/adapters/meetings";
import { ConsoleSmsChannel, normalisePhone } from "@/server/adapters/sms";
import { buildIcs, googleCalendarUrl } from "@/lib/ics";
import { toQuery } from "@/server/services/saved-search.service";
import { createHmac } from "node:crypto";

const weights = { skills: 30, industry: 10, experienceLevel: 10, certifications: 15, timezone: 15, budget: 10, assessment: 10 };
const req = { role: "Cold Caller", skills: ["Cold Calling", "Appointment Setting"], industry: "Real Estate", experienceLevel: "MID", timezone: "America/Los_Angeles", budgetMax: 200_000, budgetMin: null, software: ["Mojo Dialer"] };
const cand = { primaryRole: "Cold Caller", skills: ["Cold Calling", "Appointment Setting", "CRM"], industries: ["Real Estate"], experienceLevel: "SENIOR", timezone: "Asia/Manila", certifications: [{ name: "Hirewise Certified Cold Caller" }], assessmentRank: 3, clientRate: { amount: 900, unit: "HOURLY" as const }, availabilityStatus: "AVAILABLE", software: ["Mojo Dialer"] };

describe("rule-based matching (Section 10)", () => {
  it("explains every rule and is deterministic for the same input", () => {
    const a = scoreCandidate(req, cand, weights, { includeSoon: true, hoursPerMonth: 173 });
    const b = scoreCandidate(req, cand, weights, { includeSoon: true, hoursPerMonth: 173 });
    expect(a).toEqual(b);
    expect(a.hardFails).toEqual([]);
    expect(a.reasons.map((r) => r.rule)).toEqual(["skills", "industry", "experienceLevel", "certifications", "timezone", "budget", "assessment", "software"]);
    expect(a.reasons.find((r) => r.rule === "skills")?.text).toBe("Matched 2/2 required skills");
    expect(a.reasons.find((r) => r.rule === "certifications")?.text).toContain("Certified: Hirewise Certified Cold Caller");
    expect(a.reasons.find((r) => r.rule === "budget")?.matched).toBe(true); // 900 × 173 = 155,700 ≤ 200,000
    // Manila vs Los Angeles wraps to a 9h difference: partial timezone credit (6/15), everything else full.
    expect(a.reasons.find((r) => r.rule === "timezone")).toMatchObject({ matched: false, points: 6, max: 15 });
    expect(a.maxScore).toBe(100);
    expect(a.score).toBe(91);
  });

  it("applies hard rules for role, availability, and skills", () => {
    const wrongRole = scoreCandidate(req, { ...cand, primaryRole: "Executive Assistant" }, weights, { includeSoon: true, hoursPerMonth: 173 });
    expect(wrongRole.hardFails[0]).toMatch(/Role is Executive Assistant/);
    const soon = scoreCandidate(req, { ...cand, availabilityStatus: "AVAILABLE_SOON" }, weights, { includeSoon: false, hoursPerMonth: 173 });
    expect(soon.hardFails[0]).toMatch(/Availability/);
    expect(scoreCandidate(req, { ...cand, availabilityStatus: "AVAILABLE_SOON" }, weights, { includeSoon: true, hoursPerMonth: 173 }).hardFails).toEqual([]);
    const noSkills = scoreCandidate(req, { ...cand, skills: ["Bookkeeping"] }, weights, { includeSoon: true, hoursPerMonth: 173 });
    expect(noSkills.hardFails).toContain("None of the required skills");
    const partial = scoreCandidate(req, { ...cand, skills: ["Cold Calling"] }, weights, { includeSoon: true, hoursPerMonth: 173 });
    expect(partial.hardFails).toEqual([]);
    expect(partial.reasons.find((r) => r.rule === "skills")).toMatchObject({ matched: false, points: 15, text: "Matched 1/2 required skills (missing appointment setting)" });
  });

  it("scores soft rules partially and respects weights", () => {
    const r = scoreCandidate(req, { ...cand, experienceLevel: "JUNIOR", certifications: [{ name: "Something else" }], assessmentRank: 1, clientRate: { amount: 1500, unit: "HOURLY" } }, { ...weights, budget: 20 }, { includeSoon: true, hoursPerMonth: 173 });
    expect(r.reasons.find((x) => x.rule === "experienceLevel")).toMatchObject({ matched: false, points: 5 }); // one level below → half
    expect(r.reasons.find((x) => x.rule === "certifications")).toMatchObject({ points: 8 }); // unrelated certification → half (rounded)
    expect(r.reasons.find((x) => x.rule === "assessment")).toMatchObject({ points: 3 });
    expect(r.reasons.find((x) => x.rule === "budget")).toMatchObject({ matched: false, points: 0, max: 20 });
    expect(r.maxScore).toBe(110);
  });
});

describe("integration adapters with local fakes (Section 13 Phase 5)", () => {
  it("fake payment provider returns an in-app checkout and parses its own webhook", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const p = new FakePaymentProvider();
    const c = await p.createCheckout({ invoiceId: "inv1", number: "HW-2026-00009", amount: 5000, currency: "USD", description: "d", clientEmail: null, successUrl: "s", cancelUrl: "c" });
    expect(c.url).toContain("/api/payments/fake/inv1");
    expect(p.parseWebhook(JSON.stringify({ invoiceId: "inv1", amount: 5000, currency: "USD", sessionId: c.sessionId }))).toMatchObject({ type: "checkout.session.completed", invoiceId: "inv1", amount: 5000 });
    expect(await new ManualPaymentProvider().createCheckout()).toBeNull();
  });

  it("stripe adapter verifies the signature and rejects tampering or stale timestamps", () => {
    const p = new StripePaymentProvider("sk_test", "whsec_test");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", amount_total: 5000, currency: "usd", payment_intent: "pi_1", metadata: { invoiceId: "inv1" } } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = `t=${ts},v1=${createHmac("sha256", "whsec_test").update(`${ts}.${body}`).digest("hex")}`;
    expect(p.parseWebhook(body, sig)).toMatchObject({ invoiceId: "inv1", amount: 5000, currency: "USD", reference: "pi_1" });
    expect(() => p.parseWebhook(body.replace("5000", "5001"), sig)).toThrow(/signature/i);
    expect(() => p.parseWebhook(body, null)).toThrow(/Missing/);
    const old = ts - 3600;
    expect(() => p.parseWebhook(body, `t=${old},v1=${createHmac("sha256", "whsec_test").update(`${old}.${body}`).digest("hex")}`)).toThrow(/Stale/);
  });

  it("fake meeting provider is deterministic; none returns null", async () => {
    const f = new FakeMeetingProvider();
    const req = { topic: "t", startAt: new Date("2026-10-01T10:00:00Z"), durationMin: 30, timezone: "UTC" };
    const a = await f.createMeeting(req);
    const b = await f.createMeeting(req);
    expect(a.joinUrl).toBe(b.joinUrl);
    expect(a.joinUrl).toMatch(/^https:\/\/meet\.hirewise\.example\//);
    expect(await new NoMeetingProvider().createMeeting()).toBeNull();
  });

  it("sms console channel records sends; phone normalisation is strict", async () => {
    const c = new ConsoleSmsChannel();
    await c.send({ to: "+639170000000", subject: "s", text: "t" });
    expect(c.sent).toHaveLength(1);
    expect(normalisePhone("+63 917 000 0000")).toBe("+639170000000");
    expect(normalisePhone("0917 000 0000")).toBe("+09170000000".replace("+0", "+0"));
    expect(normalisePhone("call me")).toBeNull();
    expect(normalisePhone("")).toBeNull();
  });

  it("ics builder escapes text and produces a valid event", () => {
    const ics = buildIcs({ uid: "iv1", title: "Interview: Jose, Cold Caller; round 1", startAt: new Date("2026-10-01T10:00:00Z"), durationMin: 45, url: "https://meet.hirewise.example/x" });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Interview: Jose\\, Cold Caller\\; round 1");
    expect(ics).toContain("DTSTART:20261001T100000Z");
    expect(ics).toContain("DTEND:20261001T104500Z");
    expect(googleCalendarUrl({ uid: "x", title: "T", startAt: new Date("2026-10-01T10:00:00Z"), durationMin: 30 })).toContain("dates=20261001T100000Z%2F20261001T103000Z");
  });

  it("saved search filters round-trip to a query string", () => {
    expect(toQuery({ q: "solar", skills: ["a", "b"], verification: "PROFILE_VERIFIED", tzWithin: 6 })).toBe("q=solar&skills=a&skills=b&verification=PROFILE_VERIFIED&tzWithin=6");
  });
});
