import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnShortlist } from "@/server/services/shortlist.service";
import { listOwnRequirements } from "@/server/services/requirement.service";
import { getOwnClient } from "@/server/services/client.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Banner, EmptyState } from "@/components/app/ui";
import { InterviewRequestForm } from "@/components/interviews/InterviewRequestForm";
import Link from "next/link";

export const metadata: Metadata = { title: "Request interviews" };

export default async function NewInterviewRequestPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const actor = await requireActor();
  if (actor.role !== "CLIENT") redirect("/dashboard");
  const { ids } = await searchParams;
  let list: Awaited<ReturnType<typeof getOwnShortlist>>;
  try {
    list = await getOwnShortlist(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
    throw e;
  }
  const [requirements, client] = await Promise.all([listOwnRequirements(prisma, actor), getOwnClient(prisma, actor)]);
  return (
    <>
      <PageHeader eyebrow="Interviews" title="Request interviews" description="Choose shortlisted candidates and tell Hirewise when you are available. Your account manager confirms with the candidates and schedules; nobody's contact details change hands." />
      {list.candidates.length === 0 ? (
        <EmptyState title="Shortlist candidates first" description="Interview requests are made from your shortlist." action={<Link href="/talent" className="inline-flex h-10 items-center rounded-full bg-ink-900 px-5 text-[14px] font-semibold text-white">Find talent</Link>} />
      ) : (
        <InterviewRequestForm candidates={list.candidates.map((c) => ({ id: c.id, displayName: c.displayName, primaryRole: c.primaryRole }))} preselected={(ids ?? "").split(",").filter(Boolean)} requirements={requirements.filter((r) => r.status !== "CLOSED").map((r) => ({ id: r.id, title: r.title, role: r.role }))} defaultTimezone={client.timezone ?? "America/Los_Angeles"} />
      )}
    </>
  );
}
