"use client";

import { VideoPlayer } from "@/components/academy/VideoPlayer";

type Props = {
  src: string;
  title: string;
  requiredPercent: number;
  initialPercent: number;
  initialPositionSec: number;
  initialCompleted: boolean;
  completedAt: Date | string | null;
};

/**
 * The onboarding welcome video on the lesson player infrastructure (Course Builder phase 9): the same tracker,
 * crediting rule, and progress bar as lesson videos, reporting to the onboarding endpoint. Seeking forward past what
 * has been watched is clamped, as before.
 */
export function WelcomeVideoPlayer(p: Props) {
  return (
    <VideoPlayer
      lessonId="welcome-video"
      endpoint="/api/onboarding/video-progress"
      src={p.src}
      title={p.title}
      durationSec={null}
      requiredPercent={p.requiredPercent}
      trackable
      restrictSeek
      completedNote="Thank you for watching. Your courses are unlocked."
      initial={{ percent: p.initialPercent, positionSec: p.initialPositionSec, mediaCompleted: p.initialCompleted, status: p.initialCompleted ? "COMPLETED" : "IN_PROGRESS" }}
    />
  );
}
