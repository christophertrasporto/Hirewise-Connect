"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  src: string;
  title: string;
  requiredPercent: number;
  initialPercent: number;
  initialPositionSec: number;
  initialCompleted: boolean;
  completedAt: Date | string | null;
};

type ServerState = { percent: number; completed: boolean; lastPositionSec: number };

/**
 * Tracks time actually played and reports it every 8 seconds, on pause, and when the page is hidden.
 * Seeking is only allowed back into what has been played (plus a small slack), so dragging to the end
 * does not count; the server caps credited time against wall-clock time as a second guard.
 */
export function WelcomeVideoPlayer(p: Props) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ServerState>({ percent: p.initialPercent, completed: p.initialCompleted, lastPositionSec: p.initialPositionSec });
  const [error, setError] = useState<string | null>(null);
  const [resumeFrom, setResumeFrom] = useState(p.initialPositionSec);

  // Mutable tracking state lives in refs so event handlers never see stale values.
  const track = useRef({ lastTime: 0, maxReached: p.initialPositionSec, pendingDelta: 0, lastReportAt: Date.now(), duration: 0, playing: false, seeking: false, resumed: false });

  async function report(useBeacon = false) {
    const t = track.current;
    const el = video.current;
    const delta = t.pendingDelta;
    if (delta <= 0 && state.completed) return;
    const payload = JSON.stringify({ positionSec: el?.currentTime ?? t.lastTime, watchedDeltaSec: Math.round(delta * 100) / 100, durationSec: t.duration || undefined, elapsedMs: Date.now() - t.lastReportAt, playbackRate: el?.playbackRate ?? 1 });
    t.pendingDelta = 0;
    t.lastReportAt = Date.now();
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/onboarding/video-progress", new Blob([payload], { type: "text/plain" }));
      return;
    }
    try {
      const res = await fetch("/api/onboarding/video-progress", { method: "POST", body: payload, headers: { "Content-Type": "text/plain" }, keepalive: true });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not save your progress.");
        return;
      }
      const j = (await res.json()) as ServerState;
      setError(null);
      setState((prev) => {
        if (!prev.completed && j.completed) setTimeout(() => router.refresh(), 400);
        return { percent: j.percent, completed: j.completed, lastPositionSec: j.lastPositionSec };
      });
    } catch {
      setError("Could not save your progress. Check your connection; your position is kept while you stay on this page.");
    }
  }

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const t = track.current;

    const onLoaded = () => {
      t.duration = Number.isFinite(el.duration) ? el.duration : 0;
      if (!t.resumed && resumeFrom > 0 && resumeFrom < t.duration - 1) {
        el.currentTime = resumeFrom;
        t.lastTime = resumeFrom;
      }
      t.resumed = true;
    };
    const onTimeUpdate = () => {
      if (t.seeking) return;
      const now = el.currentTime;
      const d = now - t.lastTime;
      // Only forward motion at playback speed counts; jumps are seeks or decoder hiccups.
      if (d > 0 && d < 1.5 * (el.playbackRate || 1) && !el.paused) t.pendingDelta += d;
      t.lastTime = now;
      if (now > t.maxReached) t.maxReached = now;
      if (Date.now() - t.lastReportAt > 8000 && t.pendingDelta > 0) void report();
    };
    const onSeeking = () => {
      t.seeking = true;
      // Allow seeking back freely; forward only within what has been played (+3 s slack).
      if (!state.completed && el.currentTime > t.maxReached + 3) {
        el.currentTime = t.maxReached;
      }
    };
    const onSeeked = () => {
      t.seeking = false;
      t.lastTime = el.currentTime;
    };
    const onPlay = () => {
      t.playing = true;
      t.lastTime = el.currentTime;
      t.lastReportAt = Date.now();
    };
    const onPause = () => {
      t.playing = false;
      void report();
    };
    const onEnded = () => void report();
    const onRate = () => {
      if (el.playbackRate > 2) el.playbackRate = 2;
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && t.pendingDelta > 0) void report(true);
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("ratechange", onRate);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("ratechange", onRate);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.completed]);

  useEffect(() => setResumeFrom(p.initialPositionSec), [p.initialPositionSec]);

  const pct = Math.min(100, state.percent);
  return (
    <div className="space-y-4">
      <video ref={video} controls controlsList="nodownload" playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-ink-900" src={p.src} />
      <div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-semibold text-ink-800">{state.completed ? <span className="inline-flex items-center gap-1.5 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Completed</span> : <span className="inline-flex items-center gap-1.5"><PlayCircle className="h-4 w-4 text-ink-400" /> {pct}% watched</span>}</span>
          <span className="text-ink-400">{state.completed ? "" : `${p.requiredPercent}% required`}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
          <div className={`h-full rounded-full transition-all ${state.completed ? "bg-brand-500" : "bg-gradient-to-r from-brand-400 to-brand-600"}`} style={{ width: `${pct}%` }} />
          {!state.completed && <div className="relative -mt-2 h-2 border-l-2 border-ink-400/50" style={{ marginLeft: `${p.requiredPercent}%` }} />}
        </div>
        <p className="mt-2 text-[12.5px] text-ink-400">{state.completed ? "Thank you for watching. Your courses are unlocked." : "Only time you actually watch counts. You can pause and come back; we resume where you left off."}</p>
        {error && <p className="mt-2 text-[12.5px] font-medium text-red-600">{error}</p>}
      </div>
    </div>
  );
}
