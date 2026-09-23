import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getPlacementForStaff, serviceAgreementFor } from "@/server/services/placement.service";
import { listDepositPolicies } from "@/server/services/billing.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { ApproveForm, PlacementButton, StartDateForm, Checklist, SignedAgreementUploader, PaymentForm, DepositTools, VoidInvoiceForm, InvoicePdfLink } from "@/components/commercial/PlacementActions";
import { renderMarkdown } from "@/lib/markdown";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Placement" };

const STEPS = ["SELECTED", "AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE"];
const STEP_LABEL: Record<string, string> = { SELECTED: "Selected", AWAITING_AGREEMENT: "Hirewise approved · agreement", AWAITING_DEPOSIT: "Deposit", DEPLOYMENT_PREP: "Deployment prep", ACTIVE: "Active" };

export default async function StaffPlacementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let p: Awaited<ReturnType<typeof getPlacementForStaff>>;
  try {
    p = await getPlacementForStaff(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">{e.message}</Banner>;
    throw e;
  }
  const can = (k: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(k);
  const policies = can("deposit.read") ? await listDepositPolicies(prisma, actor) : [];
  const agreement = ["AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE", "PAUSED", "COMPLETED"].includes(p.status) && p.billingRate ? await serviceAgreementFor(prisma, actor, p.id).catch(() => null) : null;
  const stepIdx = STEPS.indexOf(p.status === "PAUSED" ? "ACTIVE" : p.status);
  const openInvoice = p.invoices.find((i) => i.status === "ISSUED");

  return (
    <>
      <Link href="/staff/placements" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Placements</Link>
      <PageHeader eyebrow={p.client.companyName} title={`${p.agent.displayName} · ${p.positionTitle}`} description={`${p.schedule ?? "Schedule TBD"} · ${p.timezone ?? "timezone TBD"} · selected ${fmtDate(p.createdAt)}${p.accountManager ? ` · manager ${p.accountManager.email}` : ""}`} actions={<StatusBadge status={p.status} />} />

      {!["CANCELLED", "COMPLETED"].includes(p.status) && (
        <ol className="mb-6 flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => <li key={s} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${i < stepIdx ? "bg-brand-50 text-brand-700" : i === stepIdx ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-400"}`}>{STEP_LABEL[s]}</li>)}
        </ol>
      )}
      {p.status === "CANCELLED" && <div className="mb-6"><Banner tone="danger" title="Cancelled">{p.cancelledReason}</Banner></div>}
      {p.status === "COMPLETED" && <div className="mb-6"><Banner tone="info" title={`Completed ${fmtDate(p.endedAt)}`}>{p.endReason}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {p.status === "SELECTED" && (
            <Card title="Hirewise approval" description="Requires a PUBLISHED client billing rate for the agent. Approval snapshots the rate, creates the deposit from the chosen policy, and issues the deposit invoice.">
              {can("placement.approve") ? <ApproveForm placementId={p.id} policies={policies.filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name, type: x.type, isDefault: x.isDefault }))} startDate={p.startDate ? p.startDate.toISOString().slice(0, 10) : null} /> : <p className="text-[14px] text-ink-500">Waiting for an Admin to approve. Make sure the agent has a published client rate (Talent → agent → Client billing rate).</p>}
            </Card>
          )}

          {p.status === "AWAITING_AGREEMENT" && (
            <Card title="Service agreement" description="The client accepts online under Placements, or you record a signed PDF.">
              {can("placement.manage") ? <SignedAgreementUploader placementId={p.id} /> : <p className="text-[14px] text-ink-500">Waiting for the client to accept.</p>}
            </Card>
          )}

          {p.deposit && (
            <Card title="Deposit" description={`${p.deposit.policy} · due ${fmtDate(p.deposit.dueDate)}`} actions={<StatusBadge status={p.deposit.status} />}>
              <p className="font-display text-[2rem] font-extrabold text-ink-900">{p.deposit.amountLabel}</p>
              {p.deposit.status === "PENDING" && <div className="mt-4"><DepositTools depositId={p.deposit.id} placementId={p.id} policies={policies.filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name, type: x.type }))} canWaive={can("deposit.override")} canRecalculate={can("deposit.manage")} /></div>}
              {p.deposit.status === "PARTIALLY_PAID" && can("deposit.override") && <div className="mt-4"><DepositTools depositId={p.deposit.id} placementId={p.id} policies={[]} canWaive canRecalculate={false} /></div>}
            </Card>
          )}

          {p.invoices.length > 0 && (
            <Card title="Invoices">
              <ul className="divide-y divide-ink-100">
                {p.invoices.map((i) => (
                  <li key={i.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><Link href={`/staff/commercial/invoices/${i.id}`} className="text-[14.5px] font-semibold text-brand-600">{i.number}</Link> <span className="text-[13px] text-ink-500">· {i.amountLabel} · due {fmtDate(i.dueAt)}{i.paidAt ? ` · paid ${fmtDate(i.paidAt)}` : ""}</span></div>
                      <div className="flex items-center gap-3"><StatusBadge status={i.status} /><InvoicePdfLink invoiceId={i.id} label="PDF" /></div>
                    </div>
                    {i.status === "ISSUED" && can("payment.record") && i.id === openInvoice?.id && <div className="mt-3"><PaymentForm invoiceId={i.id} placementId={p.id} balanceLabel={i.amountLabel} /></div>}
                    {i.status === "ISSUED" && can("invoice.manage") && <div className="mt-2"><VoidInvoiceForm invoiceId={i.id} placementId={p.id} /></div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.checklist.length > 0 && (
            <Card title="Deployment checklist" description="All required items must be done and a start date set before activation.">
              <Checklist placementId={p.id} items={p.checklist} editable={p.status === "DEPLOYMENT_PREP" && (can("placement.manage") || can("placement.activate"))} />
            </Card>
          )}

          {agreement && (
            <Card title="Placement Service Agreement" description={p.agreement.acceptedAt ? `Accepted ${fmtDate(p.agreement.acceptedAt)}${p.agreement.signedUpload ? " (signed PDF on file)" : " (online)"}` : "Not yet accepted."}>
              <details><summary className="cursor-pointer text-[13.5px] font-semibold text-brand-700">Show rendered agreement (v{agreement.version})</summary><div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5 text-[13.5px]">{renderMarkdown(agreement.bodyMarkdown)}</div></details>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Commercial terms">
            <dl className="space-y-3 text-[14px]">
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Client billing rate</dt><dd className="mt-0.5 font-semibold text-ink-900">{p.billingRate ? p.billingRate.label : can("billing_rate.read") ? "Not snapshotted yet" : "Hidden"}</dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Agent compensation</dt><dd className="mt-0.5 font-semibold text-ink-900">{can("compensation.read") ? (p.compensation ? p.compensation.label : "No compensation record") : <span className="font-normal text-ink-400">Requires compensation.read</span>}</dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Start date</dt><dd className="mt-0.5 font-semibold text-ink-900">{p.startDate ? fmtDate(p.startDate) : "Not set"}</dd></div>
              {p.activatedAt && <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Activated</dt><dd className="mt-0.5 font-semibold text-ink-900">{fmtDate(p.activatedAt)}</dd></div>}
            </dl>
            {can("placement.manage") && !["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"].includes(p.status) && <div className="mt-4"><StartDateForm placementId={p.id} startDate={p.startDate ? p.startDate.toISOString().slice(0, 10) : null} /></div>}
          </Card>

          <Card title="Actions">
            <div className="space-y-3">
              {p.status === "DEPLOYMENT_PREP" && can("placement.activate") && <PlacementButton placementId={p.id} op="ACTIVATE" label="Activate placement" variant="primary" />}
              {p.status === "ACTIVE" && can("placement.manage") && <PlacementButton placementId={p.id} op="PAUSE" label="Pause" variant="outline" withReason />}
              {p.status === "PAUSED" && can("placement.manage") && <PlacementButton placementId={p.id} op="RESUME" label="Resume" variant="dark" />}
              {["ACTIVE", "PAUSED"].includes(p.status) && can("placement.manage") && <PlacementButton placementId={p.id} op="COMPLETE" label="Mark completed" variant="outline" withReason />}
              {!["COMPLETED", "CANCELLED"].includes(p.status) && can("placement.manage") && <PlacementButton placementId={p.id} op="CANCEL" label="Cancel placement" variant="danger" withReason confirm="Cancel this placement? The agent returns to available." />}
              {!can("placement.manage") && !can("placement.activate") && <EmptyState title="Read-only" />}
            </div>
          </Card>

          <Card title="People">
            <dl className="space-y-2 text-[14px]">
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Talent</dt><dd><Link href={`/staff/talent/${p.agent.id}`} className="font-semibold text-brand-600">{p.agent.displayName}</Link> <span className="text-ink-400">· {labelFor(p.agent.availabilityStatus)}</span></dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Client</dt><dd className="font-medium text-ink-800">{p.client.companyName}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
