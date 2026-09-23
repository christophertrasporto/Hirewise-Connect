import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listAgreementsForAdmin } from "@/server/services/launch.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, fmtDate } from "@/components/app/ui";
import { AgreementVersionForm } from "@/components/launch/LaunchForms";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = { title: "Agreements" };

export default async function StaffAgreementsPage() {
  const actor = await requireActor();
  let rows: Awaited<ReturnType<typeof listAgreementsForAdmin>>;
  try {
    rows = await listAgreementsForAdmin(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires agreement.manage">Agreement versioning is for Admins.</Banner>;
    throw e;
  }
  const pending = rows.filter((r) => !r.active || r.active.placeholder).length;
  return (
    <>
      <PageHeader eyebrow="Launch prep" title="Agreements and versions" description="Paste counsel-approved text and publish a new version. Previous versions stay on record with their acceptances; everyone in the required role is asked to accept the new version on their next visit (INV-I2). The placement service agreement keeps its double-brace placeholders." />
      {pending > 0 && <div className="mb-6"><Banner tone="warn" title={`${pending} agreement(s) still carry LEGAL_PLACEHOLDER`}>This is the launch blocker from Section 14 Q11. Nothing here writes legal text for you.</Banner></div>}
      <div className="space-y-4">
        {rows.map((r) => (
          <Card key={r.type} title={<span className="inline-flex items-center gap-2">{r.active?.placeholder || !r.active ? <AlertTriangle className="h-4 w-4 text-gold-600" /> : <CheckCircle2 className="h-4 w-4 text-brand-600" />} {r.active?.title ?? r.type}</span>} description={`${r.type} · ${r.requiredForRole ? `required for ${r.requiredForRole.toLowerCase()}s` : "per placement"} · ${r.active ? `v${r.active.version} effective ${fmtDate(r.active.effectiveFrom)} · ${r.active.acceptances} acceptance(s)` : "no active version"}`}>
            {r.active && <details className="mb-4"><summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Show current text (v{r.active.version})</summary><div className="mt-3 max-h-[320px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5 text-[13.5px]">{renderMarkdown(r.active.bodyMarkdown)}</div></details>}
            {r.versions.length > 1 && <p className="mb-4 text-[12.5px] text-ink-400">History: {r.versions.map((v) => `v${v.version}${v.isActive ? " (active)" : ""} · ${v.acceptances} accepted`).join(" · ")}</p>}
            <details><summary className="cursor-pointer text-[13.5px] font-semibold text-brand-700">Publish a new version</summary><div className="mt-4"><AgreementVersionForm type={r.type} title={r.active?.title ?? r.type} currentBody={r.active?.bodyMarkdown ?? ""} nextVersion={(r.versions[0]?.version ?? 0) + 1} /></div></details>
          </Card>
        ))}
      </div>
    </>
  );
}
