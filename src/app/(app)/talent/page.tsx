import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { searchCandidates, searchFiltersSchema } from "@/server/services/search.service";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Banner, EmptyState } from "@/components/app/ui";
import { SearchFilters } from "@/components/marketplace/SearchFilters";
import { CandidateCard } from "@/components/marketplace/CandidateCard";

export const metadata: Metadata = { title: "Find talent" };

type SP = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function TalentSearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const parsed = searchFiltersSchema.safeParse({
    q: str(sp.q), role: str(sp.role), skills: arr(sp.skills), software: arr(sp.software), industry: str(sp.industry), level: arr(sp.level),
    availability: arr(sp.availability), setup: str(sp.setup), languages: arr(sp.languages), verification: str(sp.verification),
    campaign: str(sp.campaign), tzWithin: str(sp.tzWithin), sort: str(sp.sort),
  });
  const filters = parsed.success ? parsed.data : {};

  let result: Awaited<ReturnType<typeof searchCandidates>> | null = null;
  let blocked: string | null = null;
  try {
    result = await searchCandidates(prisma, actor, filters);
  } catch (e) {
    if (e instanceof ForbiddenError) blocked = e.message;
    else throw e;
  }
  const [skills, software] = await Promise.all([taxonomyRepository.activeSkills(prisma), taxonomyRepository.activeSoftware(prisma)]);

  return (
    <>
      <PageHeader eyebrow="Talent marketplace" title="Find verified talent" description="Every profile here was reviewed and approved by Hirewise. Filter by role, skills, software, industry, availability, and timezone overlap." />
      {blocked ? (
        <Banner tone="warn" title="Marketplace not open yet">{blocked}</Banner>
      ) : (
        <>
          <SearchFilters filters={filters} skills={skills.map((s) => ({ id: s.id, name: s.name, category: s.category }))} software={software.map((s) => ({ id: s.id, name: s.name, category: s.category }))} hasClientTimezone={!!result?.clientTimezone} />
          <p className="mt-6 mb-3 text-[13.5px] text-ink-500">{result!.total} candidate{result!.total === 1 ? "" : "s"}{result?.clientTimezone ? ` · timezone overlap measured from ${result.clientTimezone}` : ""}</p>
          {result!.cards.length === 0 ? (
            <EmptyState title="No candidates match these filters" description="Try widening availability or removing a skill." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result!.cards.map((c) => <CandidateCard key={c.id} c={c} canShortlist={actor.role === "CLIENT"} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}
