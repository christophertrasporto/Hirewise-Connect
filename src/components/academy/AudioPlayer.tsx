"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Headphones, Lock, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export type AudioPlayerInitial = { percent: number; positionSec: number; audioCompleted: boolean; status: string };
type ServerState = { percent: number; lastPositionSec: number; audioCompletedAt: string | Date | null; completedAt: string | Date | null; status: string; quizUnlocked: boolean };

type Props = {
  lessonId: string;
  src: string;
  title: string;
  durationSec: number | null;
  requiredPercent: number;
  questionCount: number;
  quizHref: string | null;
  initial: AudioPlayerInitial;
  /** False for coach previews: plays without reporting progress. */
  trackable: boolean;
};

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

/**
 * Audiobook player with real-listening tracking. Only forward motion at playback speed counts: seeks and the
 * playhead position never add listened time. Progress is reported every 8 seconds while playing, on pause, and
 * when the page is hidden, so the learner can resume on any device. The quiz unlocks once the required share is heard.
 */
export function AudioPlayer(p: Props) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState({ percent: p.initial.percent, audioCompleted: p.initial.audioCompleted, status: p.initial.status, quizUnlocked: p.initial.audioCompleted && p.questionCount > 0 });
  const [ui, setUi] = useState({ playing: false, time: p.initial.positionSec, duration: p.durationSec ?? 0, volume: 1, muted: false, rate: 1, ready: false });
  const [error, setError] = useState<string | null>(null);
  const track = useRef({ lastTime: 0, pendingDelta: 0, lastReportAt: Date.now(), duration: p.durationSec ?? 0, seeking: false, resumed: false });

  async function report(useBeacon = false) {
    if (!p.trackable) return;
    const t = track.current;
    const el = audio.current;
    const delta = t.pendingDelta;
    if (delta <= 0 && state.audioCompleted) return;
    const payload = JSON.stringify({ positionSec: el?.currentTime ?? t.lastTime, playedDeltaSec: Math.round(delta * 100) / 100, durationSec: t.duration || undefined, elapsedMs: Date.now() - t.lastReportAt, playbackRate: el?.playbackRate ?? 1 });
    t.pendingDelta = 0;
    t.lastReportAt = Date.now();
    const url = `/api/academy/lessons/${p.lessonId}/progress`;
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
      setState((prev) => {
        const audioCompleted = !!j.audioCompletedAt;
        if ((!prev.audioCompleted && audioCompleted) || (prev.status !== "COMPLETED" && j.status === "COMPLETED")) setTimeout(() => router.refresh(), 400);
        return { percent: j.percent, audioCompleted, status: j.status, quizUnlocked: j.quizUnlocked };
      });
    } catch {
      setError("Could not save your progress. Check your connection; your position is kept while you stay on this page.");
    }
  }

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const t = track.current;
    const resumeFrom = p.initial.positionSec;
    const onLoaded = () => {
      t.duration = Number.isFinite(el.duration) ? el.duration : t.duration;
      if (!t.resumed && resumeFrom > 0 && resumeFrom < t.duration - 1) {
        el.currentTime = resumeFrom;
        t.lastTime = resumeFrom;
      }
      t.resumed = true;
      setUi((u) => ({ ...u, duration: t.duration, time: el.currentTime, ready: true }));
    };
    const onTimeUpdate = () => {
      const now = el.currentTime;
      if (!t.seeking) {
        const d = now - t.lastTime;
        // Only forward motion at playback speed counts; jumps are seeks or decoder hiccups.
        if (d > 0 && d < 1.5 * (el.playbackRate || 1) && !el.paused) t.pendingDelta += d;
        t.lastTime = now;
        if (Date.now() - t.lastReportAt > 8000 && t.pendingDelta > 0) void report();
      }
      setUi((u) => ({ ...u, time: now }));
    };
    const onSeeking = () => {
      t.seeking = true;
    };
    const onSeeked = () => {
      t.seeking = false;
      t.lastTime = el.currentTime;
      setUi((u) => ({ ...u, time: el.currentTime }));
    };
    const onPlay = () => {
      t.lastTime = el.currentTime;
      t.lastReportAt = Date.now();
      setUi((u) => ({ ...u, playing: true }));
    };
    const onPause = () => {
      setUi((u) => ({ ...u, playing: false }));
      void report();
    };
    const onEnded = () => {
      setUi((u) => ({ ...u, playing: false }));
      void report();
    };
    const onRate = () => {
      if (el.playbackRate > 2) el.playbackRate = 2;
      setUi((u) => ({ ...u, rate: el.playbackRate }));
    };
    const onVolume = () => setUi((u) => ({ ...u, volume: el.volume, muted: el.muted }));
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
    el.addEventListener("volumechange", onVolume);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("ratechange", onRate);
      el.removeEventListener("volumechange", onVolume);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.audioCompleted]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError("Could not start playback."));
    else el.pause();
  };
  const seek = (sec: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(sec, ui.duration || sec));
  };
  const setRate = (r: number) => {
    const el = audio.current;
    if (el) el.playbackRate = r;
  };
  const setVolume = (v: number) => {
    const el = audio.current;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
  };

  const pct = Math.min(100, state.percent);
  const done = state.status === "COMPLETED";
  const playedShare = ui.duration ? (ui.time / ui.duration) * 100 : 0;

  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
      <audio ref={audio} preload="metadata" src={p.src} className="hidden" aria-label={p.title} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-label={ui.playing ? "Pause" : "Play"} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          {ui.playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <input type="range" min={0} max={Math.max(1, ui.duration)} step={0.5} value={Math.min(ui.time, ui.duration || ui.time)} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" className="h-2 w-full cursor-pointer accent-brand-600" style={{ background: `linear-gradient(to right, var(--color-brand-500, #2f9e6b) ${playedShare}%, rgb(226 229 236) ${playedShare}%)`, borderRadius: 9999, appearance: "auto" }} />
          <div className="mt-1 flex items-center justify-between text-[12px] tabular-nums text-ink-500">
            <span>{clock(ui.time)}</span>
            <span>{ui.duration ? clock(ui.duration) : "–:––"}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" onClick={() => setRate(s)} aria-pressed={ui.rate === s} className={cn("rounded-full px-2.5 py-1 text-[12px] font-semibold", ui.rate === s ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-100")}>{s}×</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setVolume(ui.muted || ui.volume === 0 ? 1 : 0)} aria-label={ui.muted || ui.volume === 0 ? "Unmute" : "Mute"} className="text-ink-500 hover:text-ink-900">{ui.muted || ui.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
          <input type="range" min={0} max={1} step={0.05} value={ui.muted ? 0 : ui.volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="h-1.5 w-20 cursor-pointer accent-ink-700" />
        </div>
      </div>

      {p.trackable && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-semibold text-ink-800">{done ? <span className="inline-flex items-center gap-1.5 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Completed</span> : state.audioCompleted ? <span className="inline-flex items-center gap-1.5 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Audio complete</span> : <span className="inline-flex items-center gap-1.5"><Headphones className="h-4 w-4 text-ink-400" /> {pct}% listened</span>}</span>
            <span className="text-ink-400">{state.audioCompleted ? "" : `${p.requiredPercent}% required`}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
            <div className={cn("h-full rounded-full transition-all", state.audioCompleted ? "bg-brand-500" : "bg-gradient-to-r from-brand-400 to-brand-600")} style={{ width: `${pct}%` }} />
            {!state.audioCompleted && <div className="relative -mt-2 h-2 border-l-2 border-ink-400/50" style={{ marginLeft: `${p.requiredPercent}%` }} />}
          </div>
          {p.questionCount > 0 && p.quizHref ? (
            state.quizUnlocked ? (
              <Link href={p.quizHref} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">{done ? "Review the quiz" : "Open the quiz"} <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-ink-500"><Lock className="h-3.5 w-3.5 text-gold-500" /> The quiz ({p.questionCount} question{p.questionCount === 1 ? "" : "s"}) unlocks after you listen to {p.requiredPercent}%.</p>
            )
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-400">{done ? "Lesson complete." : "Only time you actually listen counts. Pause any time; we resume where you left off, on any device."}</p>
          )}
          {error && <p className="mt-2 text-[12.5px] font-medium text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
