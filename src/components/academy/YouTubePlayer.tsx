"use client";

import { useEffect, useId, useRef } from "react";
import { useMediaProgress, type MediaInitial } from "@/components/academy/use-media-progress";
import { MediaProgressBar } from "@/components/academy/MediaProgressBar";

type Props = { lessonId: string; videoId: string; title: string; durationSec: number | null; requiredPercent: number; initial: MediaInitial; trackable: boolean };

type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlaybackRate(): number; getPlayerState(): number; seekTo(sec: number, allowSeekAhead: boolean): void; destroy(): void };
type YTNamespace = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number } };
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return new Promise(() => {});
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      if (!document.querySelector('script[src^="https://www.youtube.com/iframe_api"]')) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }
  return apiPromise;
}

/**
 * Hosted YouTube video with real-watching tracking through the IFrame Player API (privacy-enhanced host).
 * Position is polled twice a second while the player is ready; the shared tracker ignores jumps, so seeking
 * never counts, and the server caps credited time against wall-clock time.
 */
export function YouTubePlayer(p: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const mp = useMediaProgress({ lessonId: p.lessonId, trackable: p.trackable, initial: p.initial, questionCount: 0, durationSec: p.durationSec });

  useEffect(() => {
    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    void loadApi().then((YT) => {
      if (cancelled || !host.current) return;
      const mount = document.createElement("div");
      host.current.appendChild(mount);
      player = new YT.Player(mount, {
        host: "https://www.youtube-nocookie.com",
        videoId: p.videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(mp.resumeFrom) },
        events: {
          onReady: () => {
            if (!player) return;
            mp.setDuration(player.getDuration());
            mp.track.current.lastTime = player.getCurrentTime();
          },
          onStateChange: (e: { data: number }) => {
            if (!player) return;
            const now = player.getCurrentTime();
            if (e.data === YT.PlayerState.PLAYING) mp.playStart(now);
            else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
              mp.tick(now, player.getPlaybackRate(), true);
              void mp.report();
            }
          },
        },
      });
      timer = setInterval(() => {
        if (!player || typeof player.getPlayerState !== "function") return;
        const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
        mp.tick(player.getCurrentTime(), player.getPlaybackRate(), !playing);
      }, 500);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      try {
        player?.destroy();
      } catch {
        /* player already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.videoId]);

  return (
    <div>
      <div id={`yt-${id}`} ref={host} className="aspect-video w-full overflow-hidden rounded-2xl bg-ink-900 [&_iframe]:h-full [&_iframe]:w-full" title={p.title} />
      {p.trackable && <MediaProgressBar state={mp.state} requiredPercent={p.requiredPercent} questionCount={0} quizHref={null} verb="watched" error={mp.error} />}
    </div>
  );
}
