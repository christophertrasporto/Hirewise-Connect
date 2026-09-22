import { describe, expect, it } from "vitest";
import { gradeAttempt, usdToCents, courseSchema } from "@/server/services/academy.service";
import { computeLevel, satisfies, DEFAULT_REQUIREMENTS } from "@/server/services/verification.service";
import { priceLabel } from "@/server/views/academy.views";

describe("exam grading", () => {
  const qs = [
    { id: "a", correctIndex: 1, points: 1 },
    { id: "b", correctIndex: 0, points: 2 },
    { id: "c", correctIndex: 3, points: 1 },
  ];

  it("weights by points and rounds to a whole percent", () => {
    expect(gradeAttempt(qs, { a: 1, b: 0, c: 3 })).toEqual({ scorePercent: 100, correct: 3 });
    expect(gradeAttempt(qs, { a: 1, b: 2, c: 3 })).toEqual({ scorePercent: 50, correct: 2 });
    expect(gradeAttempt(qs, { a: 0 })).toEqual({ scorePercent: 0, correct: 0 });
  });

  it("ignores answers to unknown questions and never divides by zero", () => {
    expect(gradeAttempt(qs, { zzz: 1, a: 1 }).scorePercent).toBe(25);
    expect(gradeAttempt([], {}).scorePercent).toBe(0);
  });
});

describe("course pricing (USD, integer cents)", () => {
  it("converts USD strings to cents without float drift", () => {
    expect(usdToCents("49")).toBe(4900);
    expect(usdToCents("49.50")).toBe(4950);
    expect(usdToCents("0.10")).toBe(10);
    expect(usdToCents("19.99")).toBe(1999);
    expect(usdToCents("")).toBe(0);
    expect(usdToCents(undefined)).toBe(0);
  });

  it("labels free and paid courses", () => {
    expect(priceLabel(0)).toBe("Free");
    expect(priceLabel(4900)).toBe("USD 49.00");
    expect(priceLabel(1999)).toBe("USD 19.99");
  });

  it("rejects malformed prices at the schema", () => {
    const base = { title: "Course title", category: "Sales", description: "A description that is long enough to pass validation." };
    expect(courseSchema.safeParse({ ...base, priceUsd: "49.999" }).success).toBe(false);
    expect(courseSchema.safeParse({ ...base, priceUsd: "-5" }).success).toBe(false);
    expect(courseSchema.safeParse({ ...base, priceUsd: "abc" }).success).toBe(false);
    expect(courseSchema.safeParse({ ...base, priceUsd: "" }).success).toBe(true);
    expect(courseSchema.safeParse({ ...base, priceUsd: "120.5" }).success).toBe(true);
  });
});

describe("verification ladder (Section 5.6)", () => {
  const facts = (over: Partial<Parameters<typeof satisfies>[1]> = {}) => ({ profileApproved: true, videoApproved: false, approvedRecordings: 0, approvedCertifications: 0, bestAssessmentRank: 0, publishedBillingRate: false, ...over });

  it("stops at the first unmet level", () => {
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ profileApproved: false }))).toBe("PROFILE_SUBMITTED");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts())).toBe("PROFILE_VERIFIED");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ bestAssessmentRank: 1 }))).toBe("SKILLS_ASSESSED");
    // A certification without an assessment does not skip SKILLS_ASSESSED.
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ approvedCertifications: 1 }))).toBe("PROFILE_VERIFIED");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ bestAssessmentRank: 2, approvedCertifications: 1 }))).toBe("HIREWISE_CERTIFIED");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ bestAssessmentRank: 2, approvedCertifications: 1, videoApproved: true, approvedRecordings: 1 }))).toBe("INTERVIEW_READY");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ bestAssessmentRank: 3, approvedCertifications: 1, videoApproved: true, approvedRecordings: 1 }))).toBe("INTERVIEW_READY");
    expect(computeLevel(DEFAULT_REQUIREMENTS, facts({ bestAssessmentRank: 3, approvedCertifications: 1, videoApproved: true, approvedRecordings: 1, publishedBillingRate: true }))).toBe("DEPLOYMENT_READY");
  });

  it("honours admin-edited rules", () => {
    const relaxed = { ...DEFAULT_REQUIREMENTS, HIREWISE_CERTIFIED: { profileApproved: true, minApprovedCertifications: 1 }, SKILLS_ASSESSED: { profileApproved: true } };
    expect(computeLevel(relaxed, facts({ approvedCertifications: 1 }))).toBe("HIREWISE_CERTIFIED");
  });
});
