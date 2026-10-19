import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listMediaReviewQueue } from "@/server/services/media.service";
import { listClientSafeQueue } from "@/server/services/client-safe-document.service";
import { ClientSafeReviewForm, DocumentLink } from "@/components/client-protection/Forms";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { MediaPlayer } from "@/components/profile/MediaPlayer";
import { MediaReviewForm } from "@/components/staff/MediaReviewForm";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Media review" };

export default async function MediaReviewPage() {
  const actor = await requireActor();
  const [q, clientSafe] = await Promise.all([listMediaReviewQueue(prisma, actor), listClientSafeQueue(prisma, actor)]);
  const items = [
    ...q.videos.map((v) => ({ type: "VIDEO" as const, id: v.id, status: v.status, title: "Video introduction", meta: v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, "0")}` : "", submittedAt: v.submittedAt, agent: v.agent })),
    ...q.recordings.map((r) => ({ type: "RECORDING" as const, id: r.id, status: r.status, title: `${r.title} · ${labelFor(r.kind).toLowerCase()}`, meta: r.durationSec ? `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}` : "", submittedAt: r.submittedAt, agent: r.agent })),
  ].sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));

  return (
    <>
      <PageHeader eyebrow="Media review" title="Videos and voice samples awaiting approval" description="Approval here makes media visible to Hirewise; a second check below clears it for clients (client protection, phase 5). Rejections and revision requests need feedback, which the agent receives." />
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

      <div className="mt-10">
        <PageHeader eyebrow="Client-safe documents" title={`Waiting to be cleared for clients (${clientSafe.length})`} description="Clients only ever open items with status Approved for client. Generated profile and certificate PDFs are redacted automatically; video, audio, and uploaded files need a reviewer." />
        {clientSafe.length === 0 ? <EmptyState title="Nothing waiting" description="Every approved item has been cleared or rejected for client viewing." /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {clientSafe.map((d) => (
              <Card key={d.id} title={<span className="flex items-center gap-2">{labelFor(d.type)} <StatusBadge status={d.status} /></span>} description={<><Link href={`/staff/talent/${d.agent.id}`} className="font-semibold text-brand-600">{d.agent.displayName}</Link> · clients see “{d.agent.clientLabel ?? "label pending"}” · {d.agent.primaryRole ?? "—"} · created {fmtDate(d.createdAt)}</>}>
                {d.autoNote && <p className="text-[13px] text-ink-600">{d.autoNote}</p>}
                {d.findings.length > 0 && <p className="mt-1 text-[12.5px] text-gold-700">Scan found: {d.findings.join(", ")}.</p>}
                <div className="mt-2 flex flex-wrap gap-3">
                  {(d.sourceType === "VIDEO" || d.sourceType === "RECORDING") && <MediaPlayer type={d.sourceType} id={d.sourceId} />}
                  {(d.sourceType !== "VIDEO" && d.sourceType !== "RECORDING") && <DocumentLink id={d.id} label={d.isExternalLink ? "Open external link" : d.hasSanitized ? "Open generated PDF" : "Open original"} />}
                </div>
                <div className="mt-4"><ClientSafeReviewForm doc={d} /></div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
