import type { Metadata } from "next";
import Link from "next/link";
import { Columns3 } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnShortlist } from "@/server/services/shortlist.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Banner, EmptyState } from "@/components/app/ui";
import { CandidateCard } from "@/components/marketplace/CandidateCard";
import { ShortlistNote } from "@/components/marketplace/ShortlistNote";
import { CompareSelect } from "@/components/marketplace/CompareSelect";

export const metadata: Metadata = { title: "Shortlist" };

export default async function ShortlistPage() {
  const actor = await requireActor();
  let list: Awaited<ReturnType<typeof getOwnShortlist>>;
  try {
    list = await getOwnShortlist(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Shortlists open with the marketplace">{e.message}</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Shortlist" title={list.name} description="Compare up to four candidates side by side. When you are ready, request interviews and your Hirewise account manager coordinates everything (Phase 2)." actions={list.candidates.length > 1 && <CompareSelect ids={list.candidates.map((c) => ({ id: c.id, name: c.displayName }))} />} />
      {list.candidates.length === 0 ? (
        <EmptyState title="Your shortlist is empty" description="Browse the marketplace and shortlist candidates you want to compare." action={<Link href="/talent" className="inline-flex h-10 items-center rounded-full bg-ink-900 px-5 text-[14px] font-semibold text-white">Find talent</Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.candidates.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <CandidateCard c={{ ...c, shortlisted: true }} />
              <ShortlistNote agentProfileId={c.id} note={c.note ?? ""} />
            </div>
          ))}
        </div>
      )}
      {list.candidates.length > 0 && (
        <p className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-ink-500"><Columns3 className="h-4 w-4" /> Tip: select candidates above and open the comparison view.</p>
      )}
    </>
  );
}
