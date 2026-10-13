import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { myAgency } from "@/server/services/agency.service";
import { Card } from "@/components/app/ui";
import { AgencyProfileForm } from "@/components/agency/AgencyProfileForm";

export const metadata: Metadata = { title: "Agency settings" };

export default async function AgencySettingsPage() {
  const actor = await requireActor();
  const agency = await myAgency(prisma, actor);
  const canEdit = actor.permissions.has("agency.profile.manage");
  return (
    <div className="space-y-5">
      <Card title="Agency profile" description={canEdit ? "What Hirewise sees about your agency." : "Only the owner, or a manager with the profile permission, can edit this."}>
        <AgencyProfileForm agency={agency} disabled={!canEdit || agency.status !== "ACTIVE"} />
      </Card>
      <Card title="Team members" description="Owner and manager seats. Adding managers and choosing their permissions arrives in phase A2.">
        <ul className="space-y-1 text-[13.5px]">{agency.seats.map((s) => <li key={s.userId} className="flex justify-between"><span className="text-ink-800">{s.email}</span><span className="text-ink-400">{s.role === "OWNER" ? "Owner" : "Manager"}</span></li>)}</ul>
      </Card>
      <Card title="Billing" description="Placeholder. Plans, purchases, and invoices arrive with the training marketplace and reporting phases. No prices are set yet."><p className="text-[13.5px] text-ink-500">Nothing to pay yet.</p></Card>
    </div>
  );
}
