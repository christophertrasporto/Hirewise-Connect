import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listMyThreads } from "@/server/services/thread.service";
import { PageHeader, EmptyState } from "@/components/app/ui";
import { ThreadListLink } from "@/components/communication/Forms";
import { openSupportAction } from "@/app/(app)/communication-actions";

export const metadata: Metadata = { title: "Messages" };

/** Every mediated conversation the actor takes part in (v2 phase 6a). */
export default async function MessagesPage() {
  const actor = await requireActor();
  const threads = await listMyThreads(prisma, actor);
  const canStart = actor.role === "CLIENT" || actor.role === "AGENT" || !!actor.agency;
  return (
    <>
      <PageHeader eyebrow="Messages" title="Conversations with Hirewise" description="Hirewise is in every conversation and relays what is needed. Contact details, links, and rate discussions are removed automatically and recorded." actions={canStart ? <form action={openSupportAction}><button type="submit" className="inline-flex h-10 items-center rounded-full bg-brand-500 px-4 text-[13.5px] font-semibold text-white hover:bg-brand-600">Message Hirewise</button></form> : undefined} />
      {threads.length === 0 ? <EmptyState title="No conversations yet" description="Interview requests, Partner Team enquiries, and messages to Hirewise appear here." /> : (
        <div className="space-y-2">{threads.map((t) => <ThreadListLink key={t.id} id={t.id} title={t.title} counterpart={t.counterpart} status={t.status} lastMessageAt={t.lastMessageAt} />)}</div>
      )}
    </>
  );
}
