import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getApplication } from "@/server/services/agency-application.service";
import { getSetting } from "@/server/services/setting.service";
import { can, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, fmtDate } from "@/components/app/ui";
import { ReviewPanel } from "@/components/agency/ReviewPanel";

export const metadata: Metadata = { title: "Agency application" };

export default async function ApplicationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let app: Awaited<ReturnType<typeof getApplication>>;
  try {
    app = await getApplication(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Agency applications are visible to Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
  const rules = await getSetting(prisma, "agencyApplications");
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 py-1.5 text-[13.5px]"><dt className="text-ink-500">{k}</dt><dd className="text-right font-medium text-ink-800">{v || "—"}</dd></div>;

  return (
    <>
      <Link href="/staff/agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Applications</Link>
      <PageHeader eyebrow="Agency application" title={app.proposedAgencyName} description={`${app.applicantFullName} · ${app.applicantEmail} · submitted ${fmtDate(app.submittedAt)}${app.resubmittedAt ? `, resubmitted ${fmtDate(app.resubmittedAt)}` : ""}`} actions={<StatusBadge status={app.status} />} />
      {app.createdAgencyId && <div className="mb-5"><Banner tone="success" title="Approved">Agency created. <Link href={`/staff/agencies/${app.createdAgencyId}`} className="font-semibold underline underline-offset-2">Open the agency</Link>.</Banner></div>}
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card title="Application">
            <dl className="divide-y divide-ink-50">
              {row("Applicant", <>{app.applicantFullName}<span className="block text-[12px] text-ink-400">{app.applicant.email} · account role {app.applicant.role.toLowerCase().replace(/_/g, " ")}{app.applicant.hasAgentProfile ? " · has a talent profile" : ""}</span></>)}
              {row("Phone", app.applicantPhone)}
              {row("Business registration", app.businessRegistration)}
              {row("Location", `${app.city ? `${app.city}, ` : ""}${app.country}`)}
              {row("Website", app.website ? <a href={app.website} target="_blank" rel="noopener noreferrer" className="text-brand-600">{app.website}</a> : null)}
              {row("Social links", app.socialLinks.length ? app.socialLinks.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="block text-brand-600">{l}</a>) : null)}
              {row("Team size", String(app.teamSize))}
              {row("Preferred plan", app.preferredPlanKey ? app.preferredPlanKey.toLowerCase() : "decide at approval")}
              {row("Years of experience", String(app.yearsExperience))}
              {row("Services", app.services.join(", "))}
              {row("Agreement", app.agreementAccepted ? "Non-circumvention accepted" : "Not accepted")}
            </dl>
            <p className="mt-4 whitespace-pre-line rounded-2xl bg-ink-50 p-4 text-[14px] leading-relaxed text-ink-700">{app.description}</p>
          </Card>
          <Card title={`Supporting documents (${app.documents.length})`}>
            {app.documents.length === 0 ? <p className="text-[13.5px] text-ink-500">None attached.</p> : <ul className="space-y-1.5">{app.documents.map((d) => <li key={d.id}><a href={`/api/agency/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-brand-600 hover:text-brand-700"><FileText className="h-4 w-4" /> {d.name}<span className="font-normal text-ink-400">· {fmtDate(d.createdAt)}</span></a></li>)}</ul>}
          </Card>
          <Card title="History">
            <ol className="space-y-1.5 text-[13px] text-ink-600">
              {app.history.map((h, i) => <li key={i}>{fmtDate(h.at)} · {h.from ? `${h.from.replace(/_/g, " ").toLowerCase()} → ` : ""}<span className="font-semibold text-ink-800">{h.to.replace(/_/g, " ").toLowerCase()}</span> · {h.by}{h.notes ? <span className="block text-ink-500">{h.notes}</span> : null}</li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Review" description={app.reviewer ? `Reviewer: ${app.reviewer.label}` : "No reviewer yet. Start the review to take it."}>
            {can(actor, "agency.review") ? <ReviewPanel applicationId={app.id} status={app.status} reviewNotes={app.reviewNotes} defaultCooldownDays={rules.reapplyCooldownDays} /> : <p className="text-[13.5px] text-ink-500">You can read this application but not decide on it.</p>}
          </Card>
          {app.applicantVisibleMessage && app.status === "NEEDS_MORE_INFO" && <Card title="Message sent to the applicant"><p className="text-[13.5px] text-ink-700">{app.applicantVisibleMessage}</p></Card>}
          {app.rejectionReason && <Card title="Rejection"><p className="text-[13.5px] text-ink-700">{app.rejectionReason}</p>{app.reapplyAfter && <p className="mt-1 text-[12.5px] text-ink-400">May re-apply after {fmtDate(app.reapplyAfter)}.</p>}</Card>}
        </div>
      </div>
    </>
  );
}
