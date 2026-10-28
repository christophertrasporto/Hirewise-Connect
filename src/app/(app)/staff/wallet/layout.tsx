import Link from "next/link";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { PageHeader, Banner } from "@/components/app/ui";

export default async function StaffWalletLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!can(actor, "wallet.manage")) return <Banner tone="warn" title="No access">Your role has no coach wallet permissions.</Banner>;
  const tabs = [
    { href: "/staff/wallet", label: "Withdrawals" },
    { href: "/staff/wallet/fees", label: "Gateway fees" },
    { href: "/staff/wallet/coaches", label: "Coaches" },
    { href: "/staff/wallet/revenue", label: "Revenue report" },
    { href: "/staff/wallet/settings", label: "Settings" },
  ];
  return (
    <>
      <PageHeader eyebrow="Administration" title="Coach wallets" description="Withdrawal requests, the real gateway fee for each online sale, every coach's ledger, the platform revenue report, and the split settings. Every change is audited." />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Wallet sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
