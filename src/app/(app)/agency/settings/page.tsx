import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { myAgency } from "@/server/services/agency.service";
import { seatSummary, activePlans } from "@/server/services/seat.service";
import { Card, StatusBadge, fmtDate } from "@/components/app/ui";
import { AgencyProfileForm } from "@/components/agency/AgencyProfileForm";
import { SeatRequestForm, BuySeatsForm } from "@/components/agency/SeatPanels";

export const metadata: Metadata = { title: "Agency settings" };

export default async function AgencySettingsPage() {
  const actor = await requireActor();
  const [agency, seats, plans] = await Promise.all([myAgency(prisma, actor), seatSummary(prisma, actor), activePlans(prisma)]);
  const canEdit = actor.permissions.has("agency.profile.manage");
  const canBuy = actor.permissions.has("agency.billing.manage");
  const active = agency.status === "ACTIVE";
  const t = seats.totals;
  return (
    <div className="space-y-5">
      <Card title="Agency profile" description={canEdit ? "What Hirewise sees about your agency. Clients never see any of it." : "Only the owner, or a manager with the profile permission, can edit this."}>
        <AgencyProfileForm agency={agency} disabled={!canEdit || !active} />
      </Card>

      <Card title="Client-facing identity" description="How clients see your team. Assigned by Hirewise and read-only here: your real name, logo, website, and contact details are never shown to clients.">
        {agency.clientFacing ? (
          <dl className="grid gap-3 text-[14px] sm:grid-cols-3">
            <div><dt className="text-ink-400">Partner Team code</dt><dd className="font-mono font-semibold text-ink-900">{agency.clientFacing.code}</dd></div>
            <div><dt className="text-ink-400">Name clients see</dt><dd className="font-semibold text-ink-900">{agency.clientFacing.name}</dd></div>
            <div><dt className="text-ink-400">Specializations</dt><dd className="font-semibold text-ink-900">{agency.clientFacing.specializations.join(", ") || "Set by Hirewise"}</dd></div>
          </dl>
        ) : <p className="text-[13.5px] text-ink-500">Hirewise assigns the client-facing identity.</p>}
        <p className="mt-3 text-[12.5px] text-ink-400">Ask your Hirewise contact to adjust the name or specializations.</p>
      </Card>

      <div id="seats" className="scroll-mt-6">
        <Card title="Membership plan and Agent Seats" description="Agent Seats are how many agents your agency may have at once. Course seats for training are separate.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[["Plan", seats.plan ? seats.plan.name : "Not assigned", seats.plan ? `${seats.plan.priceLabel}${seats.planStartedAt ? ` · since ${fmtDate(seats.planStartedAt)}` : ""}` : "Ask Hirewise to assign a plan"], ["Total seats", String(t.total), `${t.base} plan · ${t.additional} purchased · ${t.promo} promo${t.adjustments ? ` · ${t.adjustments > 0 ? "+" : ""}${t.adjustments} adjusted` : ""}`], ["In use", String(t.used), t.pendingRelease ? `${t.pendingRelease} pending release` : "active and pending members"], ["Available", String(t.available), seats.openInvites ? `${seats.openInvites} reserved by open invites` : "ready for invites"]].map(([label, value, note]) => (
              <div key={label} className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
                <p className="mt-1 font-display text-[1.6rem] font-extrabold leading-none text-ink-900">{value}</p>
                <p className="mt-1 text-[12px] text-ink-400">{note}</p>
              </div>
            ))}
          </div>
          {seats.overCapacity && <p className="mt-3 rounded-xl bg-gold-50 p-3 text-[13px] text-gold-800">More agents than seats. Nobody is removed; add seats or contact Hirewise.</p>}
          {!seats.plan && plans.length > 0 && (
            <div className="mt-5">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Plans</p>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {plans.map((p) => <li key={p.key} className="rounded-2xl border border-ink-100 p-4 text-[13.5px]"><p className="font-semibold text-ink-900">{p.name}</p><p className="text-ink-500">{p.baseAgentSeats === null ? "Custom agent seats" : `${p.baseAgentSeats} agent seats`} · {p.priceLabel}</p><ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-500">{p.features.map((f) => <li key={f}>• {f}</li>)}</ul></li>)}
              </ul>
            </div>
          )}
          {canBuy && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div><p className="mb-2 text-[13.5px] font-semibold text-ink-900">Add More Seats</p><BuySeatsForm packages={seats.packages} disabled={!active || !seats.plan} /></div>
              <div><p className="mb-2 text-[13.5px] font-semibold text-ink-900">Request Additional Seats</p><SeatRequestForm disabled={!active} /></div>
            </div>
          )}
          {(seats.requests.length > 0 || seats.purchases.length > 0) && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2 text-[13px]">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Seat requests</p>
                <ul className="mt-2 divide-y divide-ink-100">{seats.requests.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span className="text-ink-700">{r.requestedSeats} seat(s) · {fmtDate(r.createdAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span><StatusBadge status={r.status} /></li>)}</ul>
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Purchases</p>
                <ul className="mt-2 divide-y divide-ink-100">{seats.purchases.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 py-2"><span className="text-ink-700">{p.packageName} · {p.amountLabel} · {fmtDate(p.createdAt)}{p.paymentReference ? ` · ref ${p.paymentReference}` : ""}</span><StatusBadge status={p.status} /></li>)}</ul>
              </div>
            </div>
          )}
          <details className="mt-6">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Seat history ({seats.history.length})</summary>
            <table className="mt-3 w-full text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-2 font-semibold">When</th><th className="pb-2 font-semibold">Change</th><th className="pb-2 font-semibold">Seats</th><th className="pb-2 font-semibold">Reason</th></tr></thead>
              <tbody className="divide-y divide-ink-100">{seats.history.map((h) => <tr key={h.id}><td className="py-1.5 text-ink-500">{fmtDate(h.effectiveAt)}</td><td className="py-1.5 text-ink-800">{h.changeType.toLowerCase().replace(/_/g, " ")}{h.planName ? ` (${h.planName})` : ""}</td><td className="py-1.5 tabular-nums text-ink-800">{h.capacityDelta ? (h.capacityDelta > 0 ? `+${h.capacityDelta}` : h.capacityDelta) : h.usageDelta > 0 ? "1 used" : "1 freed"}</td><td className="py-1.5 text-ink-500">{h.reason ?? "—"}</td></tr>)}</tbody>
            </table>
          </details>
        </Card>
      </div>

      <Card title="Team members" description="Owner and manager seats for this portal. Managers and their permissions arrive in a later phase.">
        <ul className="space-y-1 text-[13.5px]">{agency.seats.map((s) => <li key={s.userId} className="flex justify-between"><span className="text-ink-800">{s.email}</span><span className="text-ink-400">{s.role === "OWNER" ? "Owner" : "Manager"}</span></li>)}</ul>
      </Card>
    </div>
  );
}
