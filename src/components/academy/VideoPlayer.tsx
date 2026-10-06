"use client";

import { useEffect, useRef } from "react";
import { useMediaProgress, type MediaInitial } from "@/components/academy/use-media-progress";
import { MediaProgressBar } from "@/components/academy/MediaProgressBar";

type Props = {
  lessonId: string;
  src: string;
  title: string;
  durationSec: number | null;
  requiredPercent: number;
  initial: MediaInitial;
  trackable: boolean;
  /** Progress endpoint override (the onboarding welcome video reports to its own route). */
  endpoint?: string;
  /** Only allow seeking back into what has already been played (plus 3 s). Off for lessons, on for the welcome video. */
  restrictSeek?: boolean;
  /** Copy under the bar once the video is complete. */
  completedNote?: string;
};

/** Uploaded video with native controls and real-watching tracking; completes once the required share is watched. */
export function VideoPlayer(p: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const mp = useMediaProgress({ lessonId: p.lessonId, trackable: p.trackable, initial: p.initial, questionCount: 0, durationSec: p.durationSec, endpoint: p.endpoint });
  const maxReached = useRef(p.initial.positionSec);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const t = mp.track.current;
    const onLoaded = () => {
      mp.setDuration(el.duration);
      if (!t.resumed && mp.resumeFrom > 0 && mp.resumeFrom < (el.duration || Infinity) - 1) {
        el.currentTime = mp.resumeFrom;
        t.lastTime = mp.resumeFrom;
      }
      t.resumed = true;
    };
    const onTimeUpdate = () => {
      mp.tick(el.currentTime, el.playbackRate, el.paused);
      if (el.currentTime > maxReached.current) maxReached.current = el.currentTime;
    };
    const onSeeking = () => {
      mp.seekStart();
      if (p.restrictSeek && !mp.state.mediaCompleted && el.currentTime > maxReached.current + 3) el.currentTime = maxReached.current;
    };
    const onSeeked = () => mp.seekEnd(el.currentTime);
    const onPlay = () => mp.playStart(el.currentTime);
    const onPause = () => void mp.report();
    const onRate = () => {
      if (el.playbackRate > 2) el.playbackRate = 2;
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("ratechange", onRate);
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("ratechange", onRate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.state.mediaCompleted]);

  return (
    <div>
      <video ref={video} controls controlsList="nodownload" playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-ink-900" src={p.src} title={p.title} />
      {p.trackable && <MediaProgressBar state={mp.state} requiredPercent={p.requiredPercent} questionCount={0} quizHref={null} verb="watched" error={mp.error} completedNote={p.completedNote} />}
    </div>
  );
}
