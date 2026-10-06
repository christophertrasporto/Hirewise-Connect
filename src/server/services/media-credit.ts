/**
 * One crediting rule for every tracked player (lesson audio and video, the onboarding welcome video).
 * The client reports seconds actually played since its previous report; the server credits at most the wall-clock
 * time that passed (times playback rate, plus 2 s of slack), never more than 60 s per report, and never more than
 * 105 % of the known duration. Opening a lesson or seeking to the end therefore never completes it.
 */
export const MAX_CREDIT_PER_REPORT_SEC = 60;
export const MAX_PLAYBACK_RATE = 2;

export function creditPlayback(p: { existingSeconds: number; deltaSec: number; elapsedMs?: number | null; playbackRate?: number | null; durationSec: number | null; requiredPercent: number }): { seconds: number; percent: number; reached: boolean; credited: number } {
  const rate = Math.min(MAX_PLAYBACK_RATE, Math.max(0.25, p.playbackRate ?? 1));
  const cap = p.elapsedMs === undefined || p.elapsedMs === null ? MAX_CREDIT_PER_REPORT_SEC : Math.min(MAX_CREDIT_PER_REPORT_SEC, (p.elapsedMs / 1000) * rate + 2);
  const credited = Math.max(0, Math.min(p.deltaSec, cap));
  const ceiling = p.durationSec ? p.durationSec * 1.05 : Number.MAX_SAFE_INTEGER;
  const seconds = Math.min(p.existingSeconds + credited, ceiling);
  const percent = p.durationSec ? Math.min(100, Math.floor((seconds / p.durationSec) * 100)) : 0;
  return { seconds, percent, reached: p.durationSec !== null && percent >= p.requiredPercent, credited };
}
