"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMediaProgress, type MediaInitial } from "@/components/academy/use-media-progress";
import { MediaProgressBar } from "@/components/academy/MediaProgressBar";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export type AudioPlayerInitial = MediaInitial;

type Props = {
  lessonId: string;
  src: string;
  title: string;
  durationSec: number | null;
  requiredPercent: number;
  questionCount: number;
  quizHref: string | null;
  initial: MediaInitial;
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
 * Audiobook player with real-listening tracking (see useMediaProgress). Custom controls: play/pause, seek bar,
 * time, volume, speed 0.75× to 2×, resume from the stored position. The quiz unlocks once the required share is heard.
 */
export function AudioPlayer(p: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const mp = useMediaProgress({ lessonId: p.lessonId, trackable: p.trackable, initial: p.initial, questionCount: p.questionCount, durationSec: p.durationSec });
  const [ui, setUi] = useState({ playing: false, time: p.initial.positionSec, duration: p.durationSec ?? 0, volume: 1, muted: false, rate: 1 });
  const [playError, setPlayError] = useState<string | null>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const t = mp.track.current;
    const onLoaded = () => {
      mp.setDuration(el.duration);
      if (!t.resumed && mp.resumeFrom > 0 && mp.resumeFrom < (el.duration || Infinity) - 1) {
        el.currentTime = mp.resumeFrom;
        t.lastTime = mp.resumeFrom;
      }
      t.resumed = true;
      setUi((u) => ({ ...u, duration: Number.isFinite(el.duration) ? el.duration : u.duration, time: el.currentTime }));
    };
    const onTimeUpdate = () => {
      mp.tick(el.currentTime, el.playbackRate, el.paused);
      setUi((u) => ({ ...u, time: el.currentTime }));
    };
    const onSeeking = () => mp.seekStart();
    const onSeeked = () => {
      mp.seekEnd(el.currentTime);
      setUi((u) => ({ ...u, time: el.currentTime }));
    };
    const onPlay = () => {
      mp.playStart(el.currentTime);
      setUi((u) => ({ ...u, playing: true }));
    };
    const onPause = () => {
      setUi((u) => ({ ...u, playing: false }));
      void mp.report();
    };
    const onRate = () => {
      if (el.playbackRate > 2) el.playbackRate = 2;
      setUi((u) => ({ ...u, rate: el.playbackRate }));
    };
    const onVolume = () => setUi((u) => ({ ...u, volume: el.volume, muted: el.muted }));
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("ratechange", onRate);
    el.addEventListener("volumechange", onVolume);
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
      el.removeEventListener("volumechange", onVolume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlayError("Could not start playback."));
    else el.pause();
  };
  const seek = (sec: number) => {
    const el = audio.current;
    if (el) el.currentTime = Math.max(0, Math.min(sec, ui.duration || sec));
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
      {playError && <p className="mt-2 text-[12.5px] font-medium text-red-600">{playError}</p>}
      {p.trackable && <MediaProgressBar state={mp.state} requiredPercent={p.requiredPercent} questionCount={p.questionCount} quizHref={p.quizHref} verb="listened" error={mp.error} />}
    </div>
  );
}
