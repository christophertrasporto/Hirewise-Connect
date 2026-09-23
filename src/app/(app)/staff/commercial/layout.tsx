import Link from "next/link";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { PageHeader, Banner } from "@/components/app/ui";

export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const tabs = [
    can(actor, "billing_rate.approve") ? { href: "/staff/commercial", label: "Rate approvals" } : null,
    can(actor, "invoice.manage") || can(actor, "deposit.read") ? { href: "/staff/commercial/invoices", label: "Invoices & payments" } : null,
    can(actor, "settings.manage") ? { href: "/staff/commercial/policies", label: "Deposit policies" } : null,
    can(actor, "report.revenue") || can(actor, "report.pipeline") ? { href: "/staff/reports", label: "Reports" } : null,
  ].filter((t): t is { href: string; label: string } => !!t);
  if (tabs.length === 0) return <Banner tone="warn" title="No access">Your role has no commercial permissions.</Banner>;
  return (
    <>
      <PageHeader eyebrow="Commercial" title="Rates, invoices, and deposits" description="Client billing rates are approved and published here. Agent compensation lives on each agent's profile and is never shown alongside client rates (INV-C1)." />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Commercial sections">
        {tabs.map((t) => <Link key={t.href} href={t.href} className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">{t.label}</Link>)}
      </nav>
      {children}
    </>
  );
}
