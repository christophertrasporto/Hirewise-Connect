import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listMediaReviewQueue } from "@/server/services/media.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { MediaPlayer } from "@/components/profile/MediaPlayer";
import { MediaReviewForm } from "@/components/staff/MediaReviewForm";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Media review" };

export default async function MediaReviewPage() {
  const actor = await requireActor();
  const q = await listMediaReviewQueue(prisma, actor);
  const items = [
    ...q.videos.map((v) => ({ type: "VIDEO" as const, id: v.id, status: v.status, title: "Video introduction", meta: v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, "0")}` : "", submittedAt: v.submittedAt, agent: v.agent })),
    ...q.recordings.map((r) => ({ type: "RECORDING" as const, id: r.id, status: r.status, title: `${r.title} · ${labelFor(r.kind).toLowerCase()}`, meta: r.durationSec ? `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}` : "", submittedAt: r.submittedAt, agent: r.agent })),
  ].sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));

  return (
    <>
      <PageHeader eyebrow="Media review" title="Videos and voice samples awaiting approval" description="Only approved media is visible to clients. Rejections and revision requests need feedback, which the agent receives." />
      {items.length === 0 ? (
        <EmptyState title="Nothing waiting for review" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((m) => (
            <Card key={`${m.type}-${m.id}`} title={<span className="flex items-center gap-2">{m.title} <StatusBadge status={m.status} /></span>} description={<>
              <Link href={`/staff/talent/${m.agent.id}`} className="font-semibold text-brand-600">{m.agent.displayName}</Link> · {m.agent.primaryRole ?? "—"} · profile {labelFor(m.agent.status).toLowerCase()} · submitted {fmtDate(m.submittedAt)} {m.meta && `· ${m.meta}`}
            </>}>
              <MediaPlayer type={m.type} id={m.id} />
              <div className="mt-4"><MediaReviewForm type={m.type} id={m.id} /></div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
