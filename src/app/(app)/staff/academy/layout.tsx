import Link from "next/link";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { PageHeader, Banner } from "@/components/app/ui";

export default async function StaffAcademyLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const tabs = [
    can(actor, "course.manage") ? { href: "/staff/academy", label: "Courses" } : null,
    can(actor, "course.payment.record") ? { href: "/staff/academy/payments", label: "Payments" } : null,
    can(actor, "certification.review") ? { href: "/staff/academy/certifications", label: "Certifications" } : null,
    can(actor, "verification.manage") ? { href: "/staff/academy/settings", label: "Templates & verification" } : null,
  ].filter((t): t is { href: string; label: string } => !!t);
  if (tabs.length === 0) return <Banner tone="warn" title="No access">Your role has no Academy administration permissions.</Banner>;
  return (
    <>
      <PageHeader eyebrow="Academy administration" title="Hirewise VA Academy" description="Publish coach-built courses, record course payments, review certifications, and tune the verification ladder." />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Academy sections">
        {tabs.map((t) => <Link key={t.href} href={t.href} className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">{t.label}</Link>)}
      </nav>
      {children}
    </>
  );
}
