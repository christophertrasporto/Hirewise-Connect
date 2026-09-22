import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPendingCertifications } from "@/server/services/certification.service";
import { authorize } from "@/server/policies/authorize";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/app/ui";
import { CertificationReviewActions } from "@/components/academy/CourseActions";

export const metadata: Metadata = { title: "Academy · Certifications" };

export default async function StaffCertificationsPage() {
  const actor = await requireActor();
  authorize(actor, "certification.review");
  const pending = await listPendingCertifications(prisma, actor);
  const recent = await prisma.certification.findMany({ where: { status: { in: ["APPROVED", "REVOKED", "EXPIRED"] } }, include: { template: { select: { name: true } }, agentProfile: { select: { id: true, displayName: true } } }, orderBy: { updatedAt: "desc" }, take: 40 });

  return (
    <div className="space-y-5">
      <Card title="Pending review" description="Certifications the pipeline could not auto-approve.">
        {pending.length === 0 ? <EmptyState title="Nothing pending" /> : (
          <ul className="divide-y divide-ink-100">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-ink-900"><Link href={`/staff/talent/${c.agentProfile.id}`} className="hover:text-brand-700">{c.agentProfile.displayName}</Link> <span className="font-normal text-ink-400">· {c.template.name}</span></p>
                  <p className="text-[12.5px] text-ink-400">Requested {fmtDate(c.createdAt)}{c.assessment?.examScore !== null && c.assessment?.examScore !== undefined ? ` · exam ${c.assessment.examScore}%` : ""}{c.assessment?.resultLabel ? ` · ${c.assessment.resultLabel.label}` : ""}</p>
                </div>
                <CertificationReviewActions certificationId={c.id} mode="PENDING" />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Issued certifications" description="Revoking requires a reason and recomputes the agent's verification level.">
        {recent.length === 0 ? <EmptyState title="No certifications issued yet" /> : (
          <ul className="divide-y divide-ink-100">
            {recent.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/staff/talent/${c.agentProfile.id}`} className="text-[14.5px] font-semibold text-ink-900 hover:text-brand-700">{c.agentProfile.displayName}</Link>
                  <span className="text-[13.5px] text-ink-500">{c.template.name} · {c.origin === "ACADEMY" ? "Academy" : "Admin issued"} · {fmtDate(c.issuedAt)}{c.expiresAt ? ` → ${fmtDate(c.expiresAt)}` : ""}</span>
                  <StatusBadge status={c.status} />
                </div>
                {c.status === "APPROVED" && actor.permissions.has("certification.revoke") && <CertificationReviewActions certificationId={c.id} mode="APPROVED" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
