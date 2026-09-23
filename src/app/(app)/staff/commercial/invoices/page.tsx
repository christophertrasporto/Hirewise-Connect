import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listInvoicesForStaff } from "@/server/services/billing.service";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/app/ui";
import { PaymentForm, VoidInvoiceForm, InvoicePdfLink } from "@/components/commercial/PlacementActions";

export const metadata: Metadata = { title: "Invoices" };

export default async function StaffInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = ["ISSUED", "PAID", "VOID"].includes(sp.status ?? "") ? (sp.status as "ISSUED" | "PAID" | "VOID") : undefined;
  const rows = await listInvoicesForStaff(prisma, actor, status);
  const canRecord = actor.permissions.has("payment.record");
  const canVoid = actor.permissions.has("invoice.manage");
  return (
    <Card title="Invoices" description="Manual payment recording (Phase 4). A paid deposit invoice moves its placement to deployment preparation automatically." actions={<div className="flex gap-1.5">{[["", "All"], ["ISSUED", "Open"], ["PAID", "Paid"], ["VOID", "Void"]].map(([v, l]) => <Link key={v} href={v ? `/staff/commercial/invoices?status=${v}` : "/staff/commercial/invoices"} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${(sp.status ?? "") === v ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600"}`}>{l}</Link>)}</div>}>
      {rows.length === 0 ? <EmptyState title="No invoices" /> : (
        <ul className="divide-y divide-ink-100">
          {rows.map((i) => (
            <li key={i.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold text-ink-900"><Link href={`/staff/commercial/invoices/${i.id}`} className="hover:text-brand-700">{i.number}</Link> <span className="font-normal text-ink-400">· {i.client.companyName}</span></p>
                  <p className="text-[13px] text-ink-600">{i.description}</p>
                  <p className="text-[12.5px] text-ink-400">{i.amountLabel} · issued {fmtDate(i.issuedAt)} · due {fmtDate(i.dueAt)}{i.paidAmount ? ` · paid ${(i.paidAmount / 100).toFixed(2)}` : ""}{i.placement ? ` · ${i.placement.displayName}` : ""}</p>
                </div>
                <div className="flex items-center gap-3"><StatusBadge status={i.status} /><InvoicePdfLink invoiceId={i.id} label="PDF" /></div>
              </div>
              {i.status === "ISSUED" && canRecord && <div className="mt-3"><PaymentForm invoiceId={i.id} placementId={i.placement?.id} balanceLabel={`${i.currency} ${(i.balance / 100).toFixed(2)}`} /></div>}
              {i.status === "ISSUED" && canVoid && <div className="mt-2"><VoidInvoiceForm invoiceId={i.id} placementId={i.placement?.id} /></div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
