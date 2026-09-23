import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getInvoiceForStaff } from "@/server/services/billing.service";
import { NotFoundError } from "@/server/policies/authorize";
import { Card, StatusBadge, fmtDate } from "@/components/app/ui";
import { PaymentForm, VoidInvoiceForm, InvoicePdfLink } from "@/components/commercial/PlacementActions";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Invoice" };

export default async function StaffInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let i: Awaited<ReturnType<typeof getInvoiceForStaff>>;
  try {
    i = await getInvoiceForStaff(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <>
      <Link href="/staff/commercial/invoices" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Invoices</Link>
      <Card title={`Invoice ${i.number}`} description={`${i.client.companyName} · issued ${fmtDate(i.issuedAt)} · due ${fmtDate(i.dueAt)}`} actions={<div className="flex items-center gap-3"><StatusBadge status={i.status} /><InvoicePdfLink invoiceId={i.id} /></div>}>
        <p className="text-[15px] text-ink-700">{i.description}</p>
        <p className="mt-3 font-display text-[2.2rem] font-extrabold text-ink-900">{i.amountLabel}</p>
        <p className="text-[13px] text-ink-500">Paid {i.currency} {(i.paidAmount / 100).toFixed(2)} · balance {i.currency} {(i.balance / 100).toFixed(2)}{i.voidReason ? ` · void: ${i.voidReason}` : ""}</p>
        {i.placement && <p className="mt-2 text-[13.5px]"><Link href={`/staff/placements/${i.placement.id}`} className="font-semibold text-brand-600">Placement: {i.placement.displayName} · {i.placement.positionTitle}</Link></p>}
        {i.payments.length > 0 && (
          <ul className="mt-4 divide-y divide-ink-100 text-[13.5px]">
            {i.payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{fmtDate(p.paidAt)} · {labelFor(p.method)}{p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}</span><span className="font-semibold">{p.currency} {(p.amount / 100).toFixed(2)}</span></li>)}
          </ul>
        )}
        {i.status === "ISSUED" && actor.permissions.has("payment.record") && <div className="mt-5"><PaymentForm invoiceId={i.id} placementId={i.placement?.id} balanceLabel={`${i.currency} ${(i.balance / 100).toFixed(2)}`} /></div>}
        {i.status === "ISSUED" && actor.permissions.has("invoice.manage") && <div className="mt-3"><VoidInvoiceForm invoiceId={i.id} placementId={i.placement?.id} /></div>}
      </Card>
    </>
  );
}
