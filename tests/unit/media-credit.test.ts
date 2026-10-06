import { describe, expect, it } from "vitest";
import { creditPlayback } from "@/server/services/media-credit";
import { progressReportSchema } from "@/server/services/onboarding.service";
import { mediaReportSchema } from "@/server/services/lesson-media.service";

describe("shared playback crediting rule", () => {
  it("credits honest playback and reaches the threshold at the required share", () => {
    const r = creditPlayback({ existingSeconds: 80, deltaSec: 10, elapsedMs: 10_000, durationSec: 100, requiredPercent: 90 });
    expect(r).toEqual({ seconds: 90, percent: 90, reached: true, credited: 10 });
  });

  it("caps a report against wall-clock time times playback rate plus 2 s, and never credits more than 60 s", () => {
    expect(creditPlayback({ existingSeconds: 0, deltaSec: 60, elapsedMs: 5_000, durationSec: 100, requiredPercent: 90 }).credited).toBe(7);
    expect(creditPlayback({ existingSeconds: 0, deltaSec: 60, elapsedMs: 30_000, playbackRate: 2, durationSec: 1000, requiredPercent: 90 }).credited).toBe(60);
    expect(creditPlayback({ existingSeconds: 0, deltaSec: 60, elapsedMs: 30_000, playbackRate: 5, durationSec: 1000, requiredPercent: 90 }).credited).toBe(60); // rate clamped to 2
    expect(creditPlayback({ existingSeconds: 0, deltaSec: 60, durationSec: 1000, requiredPercent: 90 }).credited).toBe(60); // no wall-clock given: hard cap only
    expect(creditPlayback({ existingSeconds: 0, deltaSec: -5, elapsedMs: 1000, durationSec: 100, requiredPercent: 90 }).credited).toBe(0);
  });

  it("never exceeds 105 % of the duration and reports 0 % without a duration", () => {
    expect(creditPlayback({ existingSeconds: 104, deltaSec: 60, elapsedMs: 60_000, durationSec: 100, requiredPercent: 90 }).seconds).toBe(105);
    const noDuration = creditPlayback({ existingSeconds: 50, deltaSec: 10, elapsedMs: 10_000, durationSec: null, requiredPercent: 90 });
    expect(noDuration).toMatchObject({ seconds: 60, percent: 0, reached: false });
  });

  it("the onboarding endpoint accepts the lesson tracker's field name as well as its own", () => {
    expect(progressReportSchema.parse({ positionSec: 1, playedDeltaSec: 5 })).toMatchObject({ playedDeltaSec: 5 });
    expect(progressReportSchema.parse({ positionSec: 1, watchedDeltaSec: 5 })).toMatchObject({ watchedDeltaSec: 5 });
    expect(progressReportSchema.safeParse({ positionSec: 1, playedDeltaSec: 61 }).success).toBe(false);
    expect(mediaReportSchema.safeParse({ positionSec: 1, playedDeltaSec: 61 }).success).toBe(false);
  });
});
