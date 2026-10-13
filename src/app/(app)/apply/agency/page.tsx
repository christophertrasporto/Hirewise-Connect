import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireAuth } from "@/server/auth/require-actor";
import { applicationEligibility, agencyAgreement } from "@/server/services/agency-application.service";
import { getSetting } from "@/server/services/setting.service";
import { PageHeader, Card, Banner, StatusBadge, fmtDate } from "@/components/app/ui";
import { ApplyForm, ApplicationDocuments, WithdrawButton } from "@/components/agency/ApplyForm";

export const metadata: Metadata = { title: "Apply for Agency" };

/** Apply for Agency (Agency A1). No "create agency" exists here or anywhere else for non-admin users. */
export default async function ApplyForAgencyPage() {
  const auth = await requireAuth();
  const { actor } = auth;
  const [elig, rules] = await Promise.all([applicationEligibility(prisma, actor), getSetting(prisma, "agencyApplications")]);
  const app = elig.latest;
  const editable = !!app && (app.status === "SUBMITTED" || app.status === "NEEDS_MORE_INFO");
  const agreement = elig.canApply || editable ? await agencyAgreement(prisma) : null;

  return (
    <>
      <PageHeader eyebrow="Partner agencies" title="Apply to run an agency on Hirewise Connect" description="Bring your own team. Hirewise trains and certifies your agents, shares client opportunities, and handles clients, interviews, contracts, and billing. Every application is reviewed by Hirewise before an agency is created." />

      {actor.agency && <div className="mb-6"><Banner tone="success" title="You already belong to an agency"><Link href="/agency" className="font-semibold underline underline-offset-2">Open your agency portal</Link>.</Banner></div>}

      {app && (
        <div className="mb-6">
          <Card title={app.proposedAgencyName} description={`Application submitted ${fmtDate(app.submittedAt)}${app.resubmittedAt ? `, resubmitted ${fmtDate(app.resubmittedAt)}` : ""}`} actions={<StatusBadge status={app.status} />}>
            <div className="space-y-4">
              {app.status === "SUBMITTED" && <p className="inline-flex items-center gap-2 text-[14px] text-ink-700"><Clock className="h-4 w-4 text-ink-400" /> Waiting for a Hirewise reviewer. You can still edit the application until the review starts.</p>}
              {app.status === "UNDER_REVIEW" && <p className="inline-flex items-center gap-2 text-[14px] text-ink-700"><Clock className="h-4 w-4 text-gold-500" /> A Hirewise reviewer is looking at your application. You will hear back by email and here.</p>}
              {app.status === "NEEDS_MORE_INFO" && <Banner tone="warn" title="Hirewise needs more information">{app.applicantVisibleMessage ?? "Please update your application and resubmit it."}</Banner>}
              {app.status === "APPROVED" && <Banner tone="success" title={`Approved ${fmtDate(app.reviewedAt)}`}>{app.applicantVisibleMessage ? `${app.applicantVisibleMessage} ` : ""}Your agency portal is ready. <Link href="/agency" className="font-semibold underline underline-offset-2">Open My agency</Link>. If the menu does not show it yet, sign out and back in.</Banner>}
              {app.status === "REJECTED" && <Banner tone="warn" title={`Not approved ${fmtDate(app.reviewedAt)}`}><span className="block">{app.rejectionReason}</span>{app.reapplyAfter && <span className="block mt-1">You can apply again after {fmtDate(app.reapplyAfter)}.</span>}</Banner>}
              {app.status === "WITHDRAWN" && <p className="inline-flex items-center gap-2 text-[14px] text-ink-600"><XCircle className="h-4 w-4 text-ink-400" /> You withdrew this application.</p>}

              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-700">Supporting documents</p>
                <ApplicationDocuments applicationId={app.id} documents={app.documents} editable={editable} maxDocuments={rules.maxDocuments} />
              </div>

              {app.timeline.length > 1 && (
                <ol className="space-y-1 text-[12.5px] text-ink-500">
                  {app.timeline.map((t, i) => <li key={i} className="inline-flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-ink-300" /> {fmtDate(t.at)} · {t.from ? `${t.from.replace(/_/g, " ").toLowerCase()} → ` : ""}{t.to.replace(/_/g, " ").toLowerCase()}</li>)}
                </ol>
              )}
              {(app.status === "SUBMITTED" || app.status === "UNDER_REVIEW" || app.status === "NEEDS_MORE_INFO") && <WithdrawButton applicationId={app.id} />}
            </div>
          </Card>
        </div>
      )}

      {editable && agreement && app && (
        <Card title={app.status === "NEEDS_MORE_INFO" ? "Update and resubmit your application" : "Edit your application"}>
          <ApplyForm values={app} agreement={agreement} defaultEmail={auth.email} />
        </Card>
      )}

      {!app || (!editable && elig.canApply) ? (
        elig.canApply && agreement ? (
          <Card title="Application" description="Takes about ten minutes. You can add supporting documents after submitting.">
            <ApplyForm agreement={agreement} defaultEmail={auth.email} />
          </Card>
        ) : !app ? (
          <Banner tone="info" title="You cannot apply right now">{elig.reason}</Banner>
        ) : null
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[["Your team, your agency", "Invite your agents, manage their profiles, and see their training and placements in one place."], ["Hirewise in the middle", "Hirewise owns the client relationship, screening, interviews, placement, contracts, and billing. You never chase clients."], ["Training included", "Buy seats in Academy courses, assign them to your agents, and track certifications."]].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-ink-100 bg-white p-4"><p className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink-900"><Building2 className="h-4 w-4 text-brand-600" /> {t}</p><p className="mt-1 text-[13px] text-ink-500">{d}</p></div>
        ))}
      </div>
    </>
  );
}
