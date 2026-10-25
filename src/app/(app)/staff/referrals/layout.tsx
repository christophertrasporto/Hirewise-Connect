import Link from "next/link";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { PageHeader, Banner } from "@/components/app/ui";

export default async function StaffReferralsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const tabs = [
    can(actor, "referral.manage") ? { href: "/staff/referrals", label: "Affiliates and settings" } : null,
    can(actor, "payout.manage") ? { href: "/staff/referrals/payouts", label: "Payouts" } : null,
  ].filter((t): t is { href: string; label: string } => !!t);
  if (tabs.length === 0) return <Banner tone="warn" title="No access">Your role has no referral program permissions.</Banner>;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Referral program" description="Program settings, affiliates and their fraud flags, the payout queue, and manual commission changes. Every change is audited." />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Referral sections">
        {tabs.map((t) => <Link key={t.href} href={t.href} className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">{t.label}</Link>)}
      </nav>
      {children}
    </>
  );
}
