import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listHeldMessages, listOpenFlags } from "@/server/services/message.service";
import { PageHeader, Card, EmptyState } from "@/components/app/ui";
import { reviewHeldMessageAction, markFlagReviewedAction } from "@/app/(app)/actions";

export const metadata: Metadata = { title: "Compliance" };

export default async function CompliancePage() {
  const actor = await requireActor();
  const held = actor.permissions.has("interview.coordinate") ? await listHeldMessages(prisma, actor) : [];
  const flags = actor.permissions.has("flag.review") ? await listOpenFlags(prisma, actor) : [];
  return (
    <>
      <PageHeader eyebrow="Non-circumvention" title="Held messages and activity flags" description="Practical safeguards from Section 8.8: messages carrying contact details wait here; rate talk and unusual activity raise flags for review. Nothing outside the platform is inspected." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Messages held for review" description="Release to deliver, block to keep it from the other party.">
          {held.length === 0 ? <EmptyState title="Nothing held" /> : (
            <ul className="space-y-3">
              {held.map((m) => (
                <li key={m.id} className="rounded-2xl border border-gold-200 bg-gold-50 p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-gold-700">{m.authorRole.toLowerCase()} · {m.companyName} · {m.role} · <Link href={`/staff/interviews/${m.requestId}`} className="underline">open request</Link></p>
                  <p className="mt-1.5 whitespace-pre-line text-[14px] text-ink-800">{m.body}</p>
                  <div className="mt-3 flex gap-2">
                    <form action={reviewHeldMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="decision" value="RELEASE" /><button className="rounded-full bg-ink-900 px-3.5 py-1.5 text-[12.5px] font-semibold text-white">Release</button></form>
                    <form action={reviewHeldMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="decision" value="BLOCK" /><button className="rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-red-700">Block</button></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Open activity flags">
          {flags.length === 0 ? <EmptyState title="No open flags" /> : (
            <ul className="divide-y divide-ink-100">
              {flags.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-3 text-[13.5px]">
                  <div>
                    <p className="font-semibold text-ink-800">{f.rule.replace(/_/g, " ").toLowerCase()}</p>
                    <p className="text-ink-500">user {f.userId} · {new Date(f.createdAt).toLocaleString()}{f.relatedType === "InterviewRequest" && f.relatedId ? <> · <Link href={`/staff/interviews/${f.relatedId}`} className="font-semibold text-brand-600">request</Link></> : null}</p>
                    {f.details ? <p className="text-[12.5px] text-ink-400">{JSON.stringify(f.details)}</p> : null}
                  </div>
                  <form action={markFlagReviewedAction}><input type="hidden" name="flagId" value={f.id} /><button className="rounded-full border border-ink-200 px-3 py-1 text-[12.5px] font-semibold text-ink-700">Reviewed</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
