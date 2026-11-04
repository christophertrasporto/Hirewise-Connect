"use client";

import { useState, type ReactNode } from "react";
import { Play } from "lucide-react";

type Source = { kind: "file"; src: string } | { kind: "embed"; src: string };

/**
 * A free-preview video that loads nothing until it is played: the page shows the cover (the `poster`) with a play button,
 * and only a press creates the player. An uploaded video streams through our lesson route (which re-checks that the
 * lesson is a published free preview and answers with a short-lived signed link); a hosted video opens its embed.
 */
export function PreviewPlayer({ title, source, poster, autoPlayOnOpen = true }: { title: string; source: Source; poster: ReactNode; autoPlayOnOpen?: boolean }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return source.kind === "file" ? (
      <video controls controlsList="nodownload" playsInline autoPlay={autoPlayOnOpen} preload="none" src={source.src} title={title} className="aspect-video w-full rounded-3xl bg-ink-900" />
    ) : (
      <div className="aspect-video overflow-hidden rounded-3xl bg-ink-900">
        <iframe src={source.src} title={title} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setPlaying(true)} className="group relative block w-full overflow-hidden rounded-3xl text-left shadow-card focus-visible:outline-offset-2" aria-label={`Play free preview: ${title}`}>
      {poster}
      <span className="absolute inset-0 flex items-center justify-center bg-ink-900/25 transition group-hover:bg-ink-900/35">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-ink-900 shadow-lift transition group-hover:scale-105">
          <Play className="h-7 w-7 translate-x-0.5 fill-current" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
