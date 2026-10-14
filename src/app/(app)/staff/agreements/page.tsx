import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listAgreementsForAdmin } from "@/server/services/launch.service";
import { listTermsVersions, acceptanceReport } from "@/server/services/terms.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, fmtDate } from "@/components/app/ui";
import { AgreementVersionForm } from "@/components/launch/LaunchForms";
import { TermsVersionForm } from "@/components/launch/TermsVersionForm";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = { title: "Agreements" };

export default async function StaffAgreementsPage() {
  const actor = await requireActor();
  let rows: Awaited<ReturnType<typeof listAgreementsForAdmin>>;
  let terms: Awaited<ReturnType<typeof listTermsVersions>> | null = null;
  let summary: Awaited<ReturnType<typeof acceptanceReport>>["summary"] | null = null;
  try {
    rows = await listAgreementsForAdmin(prisma, actor);
    if (actor.permissions.has("terms.manage") || actor.permissions.has("terms.report")) terms = await listTermsVersions(prisma, actor);
    if (actor.permissions.has("terms.report")) summary = (await acceptanceReport(prisma, actor)).summary;
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires agreement.manage">Agreement versioning is for Admins.</Banner>;
    throw e;
  }
  const canManageTerms = actor.permissions.has("terms.manage");
  const unified = rows.filter((r) => r.unified);
  const transactional = rows.filter((r) => !r.unified && !r.superseded);
  const superseded = rows.filter((r) => r.superseded);
  const pending = [...unified, ...transactional].filter((r) => !r.active || r.active.placeholder).length;
  const docs = terms ? ([{ type: "PLATFORM_TERMS" as const, label: "Terms & Platform Agreement", versions: terms.terms }, { type: "PRIVACY_POLICY" as const, label: "Privacy Policy", versions: terms.privacy }]) : [];
  return (
    <>
      <PageHeader eyebrow="Launch prep" title="Agreements and versions" description="One Hirewise Connect Terms & Platform Agreement covers every role (Identity phase 1), accepted with a single checkbox at sign-up and re-accepted only for material versions. The placement service agreement keeps its own per-placement step. Nothing here writes legal text for you." actions={summary ? <Link href="/staff/agreements/acceptances" className="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-ink-800">Acceptance report · {summary.OUTDATED + summary.NONE} outstanding</Link> : null} />
      {pending > 0 && <div className="mb-6"><Banner tone="warn" title={`${pending} document(s) still carry LEGAL_PLACEHOLDER or have no active version`}>This is the launch blocker from Section 14 Q11.</Banner></div>}

      <div className="space-y-4">
        {docs.map((d) => {
          const active = d.versions.find((v) => v.isActive) ?? null;
          return (
            <Card key={d.type} title={<span className="inline-flex items-center gap-2">{!active || active.placeholder ? <AlertTriangle className="h-4 w-4 text-gold-600" /> : <CheckCircle2 className="h-4 w-4 text-brand-600" />} {active?.title ?? d.label}</span>} description={active ? `${d.type} · v${active.version} effective ${fmtDate(active.effectiveFrom)} · ${active.isMaterialChange ? "material" : "non-material"}${active.requiresReacceptance ? ", re-acceptance required" : ""} · ${active.acceptances} acceptance(s) · required for ${active.requiredForRoles.map((r) => r.toLowerCase().replace(/_/g, " ")).join(", ")}` : `${d.type} · no active version`}>
              {active && (
                <details className="mb-4">
                  <summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Show current sections (v{active.version})</summary>
                  <ol className="mt-3 max-h-[360px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5 text-[13.5px]">
                    {active.sections.map((s, i) => <li key={s.key}><p className="font-semibold text-ink-900">{i + 1}. {s.title} <span className="font-normal text-ink-400">· {s.audiences.join(", ").toLowerCase()}</span></p><div className="mt-1 space-y-2">{renderMarkdown(s.bodyMarkdown)}</div></li>)}
                  </ol>
                </details>
              )}
              {d.versions.length > 1 && <p className="mb-4 text-[12.5px] text-ink-400">History: {d.versions.map((v) => `v${v.version}${v.isActive ? " (active)" : ""} · ${v.acceptances} accepted${v.changeNote ? ` · ${v.changeNote}` : ""}`).join(" · ")}</p>}
              {canManageTerms ? (
                <details><summary className="cursor-pointer text-[13.5px] font-semibold text-brand-700">Publish a new version</summary><div className="mt-4"><TermsVersionForm type={d.type} title={active?.title ?? d.label} sections={active?.sections ?? []} nextVersion={(d.versions[0]?.version ?? 0) + 1} mode={active?.privacyPolicyMode ?? "COMBINED"} /></div></details>
              ) : (
                <p className="text-[12.5px] text-ink-400">Publishing the unified terms requires terms.manage (Super Admin, grantable).</p>
              )}
            </Card>
          );
        })}

        {transactional.map((r) => (
          <Card key={r.type} title={<span className="inline-flex items-center gap-2">{r.active?.placeholder || !r.active ? <AlertTriangle className="h-4 w-4 text-gold-600" /> : <CheckCircle2 className="h-4 w-4 text-brand-600" />} {r.active?.title ?? r.type}</span>} description={`${r.type} · per placement · ${r.active ? `v${r.active.version} effective ${fmtDate(r.active.effectiveFrom)} · ${r.active.acceptances} acceptance(s)` : "no active version"}`}>
            {r.active && <details className="mb-4"><summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Show current text (v{r.active.version})</summary><div className="mt-3 max-h-[320px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5 text-[13.5px]">{renderMarkdown(r.active.bodyMarkdown)}</div></details>}
            {r.versions.length > 1 && <p className="mb-4 text-[12.5px] text-ink-400">History: {r.versions.map((v) => `v${v.version}${v.isActive ? " (active)" : ""} · ${v.acceptances} accepted`).join(" · ")}</p>}
            <details><summary className="cursor-pointer text-[13.5px] font-semibold text-brand-700">Publish a new version</summary><div className="mt-4"><AgreementVersionForm type={r.type} title={r.active?.title ?? r.type} currentBody={r.active?.bodyMarkdown ?? ""} nextVersion={(r.versions[0]?.version ?? 0) + 1} /></div></details>
          </Card>
        ))}

        <Card title="Superseded documents" description="Replaced by the unified Terms & Platform Agreement. Their versions and acceptances stay on record; they can no longer be published.">
          <ul className="divide-y divide-ink-100 text-[13.5px]">
            {superseded.map((r) => <li key={r.type} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-semibold text-ink-800">{r.versions[0]?.title ?? r.type}</span><span className="text-ink-400">{r.type} · {r.versions.length} version(s) · {r.versions.reduce((n, v) => n + v.acceptances, 0)} acceptance(s)</span></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
