import { describe, expect, it } from "vitest";
import { usdToCents, courseSchema } from "@/server/services/academy.service";
import { buildSnapshot, gradeSnapshot, type SnapshotQuestion } from "@/server/services/quiz.service";
import { computeLevel, satisfies, DEFAULT_REQUIREMENTS } from "@/server/services/verification.service";
import { priceLabel } from "@/server/views/academy.views";

describe("quiz snapshots and grading", () => {
  const qs = [
    { id: "a", version: 1, type: "MULTIPLE_CHOICE" as const, prompt: "A?", points: 1, explanation: null, keywords: [], choices: [{ id: "a1", text: "x", isCorrect: false }, { id: "a2", text: "y", isCorrect: true }] },
    { id: "b", version: 1, type: "MULTIPLE_SELECT" as const, prompt: "B?", points: 2, explanation: null, keywords: [], choices: [{ id: "b1", text: "x", isCorrect: true }, { id: "b2", text: "y", isCorrect: false }, { id: "b3", text: "z", isCorrect: true }] },
    { id: "c", version: 1, type: "SHORT_ANSWER" as const, prompt: "C?", points: 1, explanation: null, keywords: ["time zone"], choices: [] },
    { id: "d", version: 1, type: "SHORT_ANSWER" as const, prompt: "D?", points: 1, explanation: null, keywords: [], choices: [] },
  ];

  it("shuffles choices by id without changing which one is correct; random draws take a subset", () => {
    let n = 0.9;
    const snap = buildSnapshot(qs, { randomizeCount: null, shuffleAnswers: true }, () => (n = (n * 7) % 1));
    expect(snap.map((q) => q.questionId)).toEqual(["a", "b", "c", "d"]);
    expect(snap[0].correctChoiceIds).toEqual(["a2"]);
    expect(new Set(snap[1].choices.map((c) => c.id))).toEqual(new Set(["b1", "b2", "b3"]));
    expect(snap[1].choices.every((c) => !("isCorrect" in c))).toBe(true);
    expect(buildSnapshot(qs, { randomizeCount: 2, shuffleAnswers: false }, () => 0.5)).toHaveLength(2);
    expect(buildSnapshot(qs, { randomizeCount: 10, shuffleAnswers: false })).toHaveLength(4);
  });

  it("grades by choice-id set (all or nothing), matches short-answer keywords, and flags manual review", () => {
    const snap = buildSnapshot(qs, { randomizeCount: null, shuffleAnswers: false }) as SnapshotQuestion[];
    const full = gradeSnapshot(snap, { a: ["a2"], b: ["b3", "b1"], c: "Log the TIME ZONE first", d: "whatever" });
    expect(full.scorePercent).toBe(80); // 4 of 5 points; d awaits a coach
    expect(full.needsReview).toBe(true);
    expect(full.perQuestion.map((p) => p.correct)).toEqual([true, true, true, null]);
    const partial = gradeSnapshot(snap, { a: ["a1"], b: ["b1"], c: "nope", zzz: ["x"] });
    expect(partial.scorePercent).toBe(0);
    expect(partial.needsReview).toBe(false);
    expect(gradeSnapshot(snap, { a: "a2" }).earned).toBe(1); // a single id string is accepted
    expect(gradeSnapshot([], {}).scorePercent).toBe(0);
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
    const base = { title: "Course title", categoryId: "cat_sales", description: "A description that is long enough to pass validation." };
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
