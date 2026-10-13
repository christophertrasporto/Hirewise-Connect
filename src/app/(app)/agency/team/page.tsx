import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { agencyAgents } from "@/server/services/agency.service";
import { Card, EmptyState, StatusBadge, Banner } from "@/components/app/ui";
import { ForbiddenError } from "@/server/policies/authorize";

export const metadata: Metadata = { title: "My team" };

export default async function AgencyTeamPage() {
  const actor = await requireActor();
  let agents: Awaited<ReturnType<typeof agencyAgents>> = [];
  try {
    agents = await agencyAgents(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Your owner has not granted you access to the team list.</Banner>;
    throw e;
  }
  return (
    <Card title={`My team (${agents.length})`} description="Agents whose primary agency is yours. Inviting agents by email, referral link, or your agency sign-up link arrives in phase A2.">
      {agents.length === 0 ? <EmptyState title="No agents yet" description="Invites open in the next phase. Agents who already have a Hirewise profile keep it when they join you." /> : (
        <ul className="divide-y divide-ink-100">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="text-[15px] font-semibold text-ink-900">{a.displayName}</p><p className="text-[12.5px] text-ink-400">{a.primaryRole ?? "Talent"} · profile {a.profileCompletion}% · {a.verificationLevel.replace(/_/g, " ").toLowerCase()}</p></div>
              <div className="flex gap-2"><StatusBadge status={a.status} /><StatusBadge status={a.availabilityStatus} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
