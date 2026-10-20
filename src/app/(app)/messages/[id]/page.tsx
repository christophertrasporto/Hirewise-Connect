import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listThreadMessages } from "@/server/services/thread.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner } from "@/components/app/ui";
import { ThreadPanel, ReportBypassForm } from "@/components/communication/Forms";
import { closeThreadAction } from "@/app/(app)/communication-actions";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof listThreadMessages>>;
  try {
    data = await listThreadMessages(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Not available">{e.message}</Banner>;
    throw e;
  }
  const { thread, audience, messages } = data;
  const closed = thread.status === "CLOSED";
  return (
    <>
      <Link href="/messages" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> All conversations</Link>
      <PageHeader eyebrow={labelFor(thread.kind)} title={thread.title} description={`With ${thread.counterpart}${thread.requestId ? "" : ""}`} actions={<><StatusBadge status={thread.status} />{thread.requestId && <Link href={audience === "STAFF" ? `/staff/interviews/${thread.requestId}` : `/interviews/${thread.requestId}`} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-ink-700">Open the interview request</Link>}</>} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <Card title="Conversation"><ThreadPanel threadId={thread.id} messages={messages} audience={audience} closed={closed} /></Card>
        <div className="space-y-5">
          {audience !== "STAFF" && <Card title="Something off?" description="If anyone asked you to take this conversation off the platform, tell Hirewise."><ReportBypassForm relatedType="MessageThread" relatedId={thread.id} compact /></Card>}
          {audience === "STAFF" && !closed && actor.permissions.has("thread.moderate") && (
            <Card title="Moderation">
              <form action={closeThreadAction} className="space-y-2">
                <input type="hidden" name="threadId" value={thread.id} />
                <input name="reason" placeholder="Reason to close" className="h-9 w-full rounded-xl border border-ink-200 px-3 text-[13px]" />
                <button type="submit" className="h-9 rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-700 hover:bg-ink-50">Close conversation</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
