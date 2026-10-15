import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { agencyMembers, seatSummary } from "@/server/services/seat.service";
import { inviteLinkForAgency, listEmailInvites } from "@/server/services/invite.service";
import { Card, EmptyState, StatusBadge, Banner, fmtDate } from "@/components/app/ui";
import { InviteTools } from "@/components/agency/SeatPanels";
import { ForbiddenError } from "@/server/policies/authorize";

export const metadata: Metadata = { title: "My team" };

/** v2 phase 2: members with their membership status, the invitation link, and email invites. */
export default async function AgencyTeamPage() {
  const actor = await requireActor();
  let members: Awaited<ReturnType<typeof agencyMembers>> = [];
  try {
    members = await agencyMembers(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Your owner has not granted you access to the team list.</Banner>;
    throw e;
  }
  const canInvite = actor.permissions.has("agency.team.invite");
  const active = actor.agency?.status === "ACTIVE";
  const [seats, link, invites] = await Promise.all([
    seatSummary(prisma, actor),
    canInvite ? inviteLinkForAgency(prisma, actor).catch(() => null) : Promise.resolve(null),
    canInvite ? listEmailInvites(prisma, actor) : Promise.resolve([]),
  ]);
  const noPlan = !seats.plan;
  return (
    <div className="space-y-5">
      {noPlan && <Banner tone="info" title="No membership plan yet">Hirewise has not assigned a plan to your agency, so you have no Agent Seats and invites are paused. Ask Hirewise to set your plan; you can see plans under Settings.</Banner>}
      {!noPlan && seats.totals.available === 0 && <Banner tone="warn" title="No Available Agent Seats">All {seats.totals.total} seat{seats.totals.total === 1 ? "" : "s"} are in use{seats.openInvites ? ` or reserved by ${seats.openInvites} open invite${seats.openInvites === 1 ? "" : "s"}` : ""}. <Link href="/agency/settings#seats" className="font-semibold underline">Add More Seats</Link> to invite again.</Banner>}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card title={`My team (${members.length})`} description={`${seats.totals.used} of ${seats.totals.total} Agent Seats in use · ${seats.totals.available} available${seats.totals.pendingRelease ? ` · ${seats.totals.pendingRelease} pending release` : ""}.`}>
          {members.length === 0 ? <EmptyState title="No agents yet" description="Share your invitation link or invite by email. Agents who already have a Hirewise profile keep it when they join you." /> : (
            <ul className="divide-y divide-ink-100">
              {members.map((m) => (
                <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">{m.displayName} {!m.hasSeat && <span className="ml-1 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-800">no seat yet</span>}</p>
                    <p className="text-[12.5px] text-ink-400">{m.primaryRole ?? "Talent"} · profile {m.profileCompletion}% · {m.verificationLevel.replace(/_/g, " ").toLowerCase()} · joined {fmtDate(m.joinedAt)} via {m.invitationSource.toLowerCase().replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex gap-2"><StatusBadge status={m.membershipStatus} /><StatusBadge status={m.availabilityStatus} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canInvite && (
          <Card title="Invite agents" description="Each join takes one Agent Seat. Leaving an agency goes through Hirewise.">
            <InviteTools link={link} invitable={noPlan ? 0 : seats.invitable} disabled={!active || noPlan} invites={invites} />
          </Card>
        )}
      </div>
    </div>
  );
}
