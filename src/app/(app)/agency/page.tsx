import type { Metadata } from "next";
import Link from "next/link";
import { Users, GraduationCap, Briefcase, Handshake, Armchair } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { myAgency, agencyAgents } from "@/server/services/agency.service";
import { seatSummary } from "@/server/services/seat.service";
import { Card } from "@/components/app/ui";

export const metadata: Metadata = { title: "My agency" };

/** Overview: the numbers an owner checks first. Training, opportunities, and placements fill in with phases A3 to A5. */
export default async function AgencyOverviewPage() {
  const actor = await requireActor();
  const [agency, agents, seats] = await Promise.all([myAgency(prisma, actor), actor.permissions.has("agency.team.read") ? agencyAgents(prisma, actor) : Promise.resolve([]), seatSummary(prisma, actor)]);
  const available = agents.filter((a) => a.availabilityStatus === "AVAILABLE" || a.availabilityStatus === "AVAILABLE_SOON").length;
  const tiles = [
    { icon: Users, label: "Agents", value: agents.length || agency.agentCount, href: "/agency/team", note: `${available} available` },
    { icon: Armchair, label: "Agent Seats", value: `${seats.totals.used} / ${seats.totals.total}`, href: "/agency/settings#seats", note: seats.plan ? `${seats.totals.available} available${seats.totals.pendingRelease ? ` · ${seats.totals.pendingRelease} pending release` : ""}` : "No plan assigned yet" },
    { icon: GraduationCap, label: "In training", value: "—", href: "/agency/training", note: "Training marketplace arrives in phase A3" },
    { icon: Briefcase, label: "Open opportunities", value: "—", href: "/agency/opportunities", note: "Opportunities arrive in phase A4" },
    { icon: Handshake, label: "Active placements", value: "—", href: "/agency/opportunities", note: "Placements arrive in phase A5" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
            <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400"><t.icon className="h-4 w-4 text-brand-600" /> {t.label}</p>
            <p className="mt-2 font-display text-[2rem] font-extrabold leading-none text-ink-900">{t.value}</p>
            <p className="mt-1 text-[12.5px] text-ink-400">{t.note}</p>
          </Link>
        ))}
      </div>
      <Card title="How your agency works on Hirewise Connect">
        <ol className="list-decimal space-y-1.5 pl-5 text-[14px] text-ink-700">
          <li>Invite your agents; each keeps one Hirewise profile that moves with them.</li>
          <li>Buy Academy seats and assign courses; certifications land on the agent&apos;s profile.</li>
          <li>Hirewise shares client opportunities with eligible agencies; you submit eligible agents.</li>
          <li>Hirewise reviews, coordinates interviews, contracts, and billing. You see placement status and schedule, never client contacts or commercials.</li>
        </ol>
      </Card>
    </div>
  );
}
