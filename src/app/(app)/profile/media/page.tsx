import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { MediaUploads } from "@/components/profile/MediaUploads";
import { MediaPlayer } from "@/components/profile/MediaPlayer";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Video & voice" };

export default async function MediaPage() {
  const actor = await requireActor();
  const p = await getOwnProfile(prisma, actor);
  return (
    <>
      <PageHeader title="Video introduction and voice samples" description="Hirewise reviews every upload before clients can see or hear it. Keep the video to 60–120 seconds: who you are, what you do, and the campaigns you have worked." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Video introduction">
          {p.videos.length === 0 ? (
            <EmptyState title="No video yet" description="Upload an MP4 or WebM up to 200 MB." />
          ) : (
            <ul className="mb-4 space-y-3">
              {p.videos.map((v) => (
                <li key={v.id} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-ink-800">Uploaded {fmtDate(v.createdAt)}{v.durationSec ? ` · ${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, "0")}` : ""}</p>
                    <StatusBadge status={v.status} />
                  </div>
                  {v.reviewFeedback && <p className="mt-2 rounded-xl bg-gold-50 px-3 py-2 text-[13px] text-gold-700"><span className="font-semibold">{labelFor(v.status)}:</span> {v.reviewFeedback}</p>}
                  {v.status !== "RETIRED" && <MediaPlayer type="VIDEO" id={v.id} />}
                </li>
              ))}
            </ul>
          )}
          <MediaUploads kind="VIDEO" />
        </Card>
        <Card title="Voice samples">
          {p.recordings.length === 0 ? (
            <EmptyState title="No recordings yet" description="Introduction, cold call, customer service, or sales sample. MP3, WAV, or M4A up to 25 MB." />
          ) : (
            <ul className="mb-4 space-y-3">
              {p.recordings.map((r) => (
                <li key={r.id} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-ink-800">{r.title} <span className="font-normal text-ink-400">· {labelFor(r.kind).toLowerCase()}</span></p>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.reviewFeedback && <p className="mt-2 rounded-xl bg-gold-50 px-3 py-2 text-[13px] text-gold-700"><span className="font-semibold">{labelFor(r.status)}:</span> {r.reviewFeedback}</p>}
                  <MediaPlayer type="RECORDING" id={r.id} />
                </li>
              ))}
            </ul>
          )}
          <MediaUploads kind="RECORDING" />
        </Card>
      </div>
    </>
  );
}
