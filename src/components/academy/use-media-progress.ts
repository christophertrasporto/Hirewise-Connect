"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type MediaInitial = { percent: number; positionSec: number; mediaCompleted: boolean; status: string };
type ServerState = { percent: number; lastPositionSec: number; audioCompletedAt: string | Date | null; completedAt: string | Date | null; status: string; quizUnlocked: boolean };
export type MediaProgressState = { percent: number; mediaCompleted: boolean; status: string; quizUnlocked: boolean };

/**
 * Real-listening / real-watching tracker shared by the audio, uploaded-video, and YouTube players.
 * `tick(now, rate, paused)` is fed from timeupdate (or a poll); only forward motion at playback speed counts,
 * so seeks never add time. Progress is reported every 8 s while playing, on pause or end, and when the page is
 * hidden (sendBeacon), and the server caps every report against wall-clock time.
 */
export function useMediaProgress(p: { lessonId: string; trackable: boolean; initial: MediaInitial; questionCount: number; durationSec: number | null; /** Defaults to the lesson progress endpoint; the onboarding welcome video points at its own. */ endpoint?: string }) {
  const router = useRouter();
  const [state, setState] = useState<MediaProgressState>({ percent: p.initial.percent, mediaCompleted: p.initial.mediaCompleted, status: p.initial.status, quizUnlocked: p.initial.mediaCompleted && p.questionCount > 0 });
  const [error, setError] = useState<string | null>(null);
  const track = useRef({ lastTime: 0, pendingDelta: 0, lastReportAt: Date.now(), duration: p.durationSec ?? 0, seeking: false, resumed: false, position: p.initial.positionSec, rate: 1 });
  const completedRef = useRef(p.initial.mediaCompleted);

  const report = useCallback(
    async (useBeacon = false) => {
      if (!p.trackable) return;
      const t = track.current;
      const delta = t.pendingDelta;
      if (delta <= 0 && completedRef.current) return;
      const payload = JSON.stringify({ positionSec: t.position, playedDeltaSec: Math.round(delta * 100) / 100, durationSec: t.duration || undefined, elapsedMs: Date.now() - t.lastReportAt, playbackRate: t.rate });
      t.pendingDelta = 0;
      t.lastReportAt = Date.now();
      const url = p.endpoint ?? `/api/academy/lessons/${p.lessonId}/progress`;
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
        return;
      }
      try {
        const res = await fetch(url, { method: "POST", body: payload, headers: { "Content-Type": "text/plain" }, keepalive: true });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Could not save your progress.");
          return;
        }
        const j = (await res.json()) as ServerState;
        setError(null);
        const mediaCompleted = !!j.audioCompletedAt;
        setState((prev) => {
          if ((!prev.mediaCompleted && mediaCompleted) || (prev.status !== "COMPLETED" && j.status === "COMPLETED")) setTimeout(() => router.refresh(), 400);
          return { percent: j.percent, mediaCompleted, status: j.status, quizUnlocked: j.quizUnlocked };
        });
        completedRef.current = mediaCompleted;
      } catch {
        setError("Could not save your progress. Check your connection; your position is kept while you stay on this page.");
      }
    },
    [p.lessonId, p.trackable, p.endpoint, router],
  );

  /** Call on every timeupdate / poll with the current position, playback rate, and whether playback is paused. */
  const tick = useCallback(
    (now: number, rate: number, paused: boolean) => {
      const t = track.current;
      t.position = now;
      t.rate = Math.min(2, rate || 1);
      if (t.seeking) return;
      const d = now - t.lastTime;
      if (d > 0 && d < 1.5 * (rate || 1) && !paused) t.pendingDelta += d;
      t.lastTime = now;
      if (Date.now() - t.lastReportAt > 8000 && t.pendingDelta > 0) void report();
    },
    [report],
  );
  const seekStart = useCallback(() => {
    track.current.seeking = true;
  }, []);
  const seekEnd = useCallback((now: number) => {
    track.current.seeking = false;
    track.current.lastTime = now;
    track.current.position = now;
  }, []);
  const playStart = useCallback((now: number) => {
    track.current.lastTime = now;
    track.current.lastReportAt = Date.now();
  }, []);
  const setDuration = useCallback((d: number) => {
    if (Number.isFinite(d) && d > 0) track.current.duration = d;
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && track.current.pendingDelta > 0) void report(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [report]);

  return { state, error, track, report, tick, seekStart, seekEnd, playStart, setDuration, resumeFrom: p.initial.positionSec };
}
