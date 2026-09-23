import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listInvoicesForClient } from "@/server/services/billing.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, StatTile, fmtDate } from "@/components/app/ui";
import { InvoicePdfLink } from "@/components/commercial/PlacementActions";
import { money } from "@/server/views/commercial.views";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const actor = await requireActor();
  let rows: Awaited<ReturnType<typeof listInvoicesForClient>>;
  try {
    rows = await listInvoicesForClient(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Clients only">Billing is available to client accounts.</Banner>;
    throw e;
  }
  const open = rows.filter((i) => i.status === "ISSUED");
  return (
    <>
      <PageHeader eyebrow="Billing" title="Invoices and deposits" description="Deposits are invoiced at Hirewise approval and unlock deployment when paid. Payments are recorded by your account manager." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile label="Open invoices" value={open.length} />
        <StatTile label="Balance due" value={money(open.reduce((s, i) => s + i.balance, 0), "USD")} />
        <StatTile label="Paid to date" value={money(rows.reduce((s, i) => s + i.paidAmount, 0), "USD")} />
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No invoices yet" description="Your first invoice appears when Hirewise approves a placement." /> : (
          <ul className="divide-y divide-ink-100">
            {rows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/billing/invoices/${i.id}`} className="text-[15px] font-semibold text-brand-600">{i.number}</Link>
                  <p className="text-[13px] text-ink-600">{i.description}</p>
                  <p className="text-[12.5px] text-ink-400">Issued {fmtDate(i.issuedAt)} · due {fmtDate(i.dueAt)}</p>
                </div>
                <div className="flex items-center gap-3"><span className="font-semibold text-ink-900">{i.amountLabel}</span><StatusBadge status={i.status} /><InvoicePdfLink invoiceId={i.id} label="PDF" /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
