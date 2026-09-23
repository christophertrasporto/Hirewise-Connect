import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getPlacementForClient, getPlacementForAgent, serviceAgreementFor } from "@/server/services/placement.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { AcceptAgreementForm, InvoicePdfLink } from "@/components/commercial/PlacementActions";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = { title: "Placement" };

const STEPS = ["SELECTED", "AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE"];
const CLIENT_LABEL: Record<string, string> = { SELECTED: "Selected · Hirewise review", AWAITING_AGREEMENT: "Your agreement", AWAITING_DEPOSIT: "Deposit", DEPLOYMENT_PREP: "Deployment prep", ACTIVE: "Active" };
const AGENT_LABEL: Record<string, string> = { SELECTED: "Selected", AWAITING_AGREEMENT: "Client agreement", AWAITING_DEPOSIT: "Client onboarding", DEPLOYMENT_PREP: "Deployment prep", ACTIVE: "Active" };

export default async function PlacementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (actor.role !== "CLIENT" && actor.role !== "AGENT") redirect(`/staff/placements/${id}`);

  if (actor.role === "AGENT") {
    let p: Awaited<ReturnType<typeof getPlacementForAgent>>;
    try {
      p = await getPlacementForAgent(prisma, actor, id);
    } catch (e) {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }
    const idx = STEPS.indexOf(p.status === "PAUSED" ? "ACTIVE" : p.status);
    return (
      <>
        <Link href="/placements" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Placements</Link>
        <PageHeader eyebrow={p.client.companyName} title={p.positionTitle} description={`${p.schedule ?? "Schedule to be confirmed"}${p.timezone ? ` · ${p.timezone}` : ""}${p.startDate ? ` · start ${fmtDate(p.startDate)}` : ""}`} actions={<StatusBadge status={p.status} />} />
        {!["CANCELLED", "COMPLETED"].includes(p.status) && <ol className="mb-6 flex flex-wrap gap-1.5">{STEPS.map((s, i) => <li key={s} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${i < idx ? "bg-brand-50 text-brand-700" : i === idx ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-400"}`}>{AGENT_LABEL[s]}</li>)}</ol>}
        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Your compensation" description="What Hirewise pays you for this placement. Never discuss rates with the client.">
            {p.compensation ? <p className="font-display text-[2rem] font-extrabold text-ink-900">{p.compensation.label}</p> : <EmptyState title="Hirewise will confirm your compensation before the start date" />}
            <p className="mt-3 text-[13px] text-ink-500">Client rate: {p.clientRatePublished ? "published by Hirewise" : "pending"}. The client rate is set by Hirewise and is not shared with talent.</p>
          </Card>
          <Card title="Deployment">
            <dl className="space-y-2 text-[14px]">
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Start date</dt><dd className="font-medium text-ink-800">{p.startDate ? fmtDate(p.startDate) : "To be confirmed"}</dd></div>
              {p.checklistProgress && <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Preparation</dt><dd className="font-medium text-ink-800">{p.checklistProgress.done} of {p.checklistProgress.total} steps done by Operations</dd></div>}
              {p.activatedAt && <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Activated</dt><dd className="font-medium text-ink-800">{fmtDate(p.activatedAt)}</dd></div>}
            </dl>
          </Card>
        </div>
      </>
    );
  }

  let p: Awaited<ReturnType<typeof getPlacementForClient>>;
  try {
    p = await getPlacementForClient(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const agreement = p.status !== "SELECTED" && p.billingRate ? await serviceAgreementFor(prisma, actor, p.id).catch(() => null) : null;
  const idx = STEPS.indexOf(p.status === "PAUSED" ? "ACTIVE" : p.status);
  const openInvoice = p.invoices.find((i) => i.status === "ISSUED");

  return (
    <>
      <Link href="/placements" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Placements</Link>
      <PageHeader eyebrow="Placement" title={`${p.agent.displayName} · ${p.positionTitle}`} description={`${p.schedule ?? "Schedule to be confirmed"}${p.timezone ? ` · ${p.timezone}` : ""}${p.startDate ? ` · start ${fmtDate(p.startDate)}` : ""}`} actions={<StatusBadge status={p.status} />} />
      {!["CANCELLED", "COMPLETED"].includes(p.status) && <ol className="mb-6 flex flex-wrap gap-1.5">{STEPS.map((s, i) => <li key={s} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${i < idx ? "bg-brand-50 text-brand-700" : i === idx ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-400"}`}>{CLIENT_LABEL[s]}</li>)}</ol>}

      {p.status === "SELECTED" && <div className="mb-6"><Banner tone="info" title="Hirewise is confirming the terms">Your account manager will confirm the client rate and prepare the service agreement. Nothing is needed from you yet.</Banner></div>}
      {p.status === "AWAITING_DEPOSIT" && openInvoice && <div className="mb-6"><Banner tone="warn" title={`Deposit of ${openInvoice.amountLabel} due ${fmtDate(openInvoice.dueAt)}`}>Open <Link href={`/billing/invoices/${openInvoice.id}`} className="font-semibold underline">invoice {openInvoice.number}</Link> for payment instructions. Deployment preparation starts once Hirewise records the payment.</Banner></div>}
      {p.status === "DEPLOYMENT_PREP" && <div className="mb-6"><Banner tone="success" title="Deposit received">Operations is preparing {p.agent.displayName} for deployment. You will be notified at activation.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {agreement && (
            <Card title="Placement Service Agreement" description={p.agreement.acceptedAt ? `Accepted ${fmtDate(p.agreement.acceptedAt)}.` : "Review and accept to proceed to the deposit."}>
              <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5 text-[13.5px]">{renderMarkdown(agreement.bodyMarkdown)}</div>
              {p.status === "AWAITING_AGREEMENT" && <div className="mt-5"><AcceptAgreementForm placementId={p.id} /></div>}
            </Card>
          )}
          {p.invoices.length > 0 && (
            <Card title="Invoices">
              <ul className="divide-y divide-ink-100">
                {p.invoices.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><Link href={`/billing/invoices/${i.id}`} className="text-[14.5px] font-semibold text-brand-600">{i.number}</Link> <span className="text-[13px] text-ink-500">· {i.amountLabel} · due {fmtDate(i.dueAt)}</span></div><div className="flex items-center gap-3"><StatusBadge status={i.status} /><InvoicePdfLink invoiceId={i.id} label="PDF" /></div></li>)}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title="Commercial terms">
            <dl className="space-y-3 text-[14px]">
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Client billing rate</dt><dd className="mt-0.5 font-semibold text-ink-900">{p.billingRate ? p.billingRate.label : "Confirmed at Hirewise approval"}</dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Deposit</dt><dd className="mt-0.5 font-semibold text-ink-900">{p.deposit ? <>{p.deposit.amountLabel} <StatusBadge status={p.deposit.status} /></> : "Per the deposit policy"}</dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Start date</dt><dd className="mt-0.5 font-semibold text-ink-900">{p.startDate ? fmtDate(p.startDate) : "To be confirmed"}</dd></div>
            </dl>
          </Card>
          <Card title="Talent"><p className="text-[15px] font-semibold text-ink-900">{p.agent.displayName}</p><p className="text-[13px] text-ink-500">{p.agent.primaryRole ?? "Talent"}</p></Card>
        </div>
      </div>
    </>
  );
}
