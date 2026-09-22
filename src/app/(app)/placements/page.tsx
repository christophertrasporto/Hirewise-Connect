import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPlacementsForClient, listPlacementsForAgent } from "@/server/services/placement.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Placements" };

export default async function PlacementsPage() {
  const actor = await requireActor();
  const rows = actor.role === "AGENT" ? await listPlacementsForAgent(prisma, actor) : await listPlacementsForClient(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Placements" title={actor.role === "AGENT" ? "Your placements" : "Selected candidates and placements"} description="A placement is created when a client selects a candidate. Hirewise approval, the service agreement, the deposit, and deployment follow (Phase 4)." />
      <Card>
        {rows.length === 0 ? <EmptyState title="No placements yet" /> : (
          <ul className="divide-y divide-ink-100">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-[15px] font-semibold text-ink-900">{actor.role === "AGENT" ? `${p.positionTitle} at ${p.client.companyName}` : `${p.agent.displayName} · ${p.positionTitle}`}</p>
                  <p className="text-[12.5px] text-ink-400">Selected {fmtDate(p.createdAt)}{p.schedule ? ` · ${p.schedule}` : ""}{p.startDate ? ` · target start ${fmtDate(p.startDate)}` : ""}</p>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
