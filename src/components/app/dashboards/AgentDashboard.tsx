import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { NotificationList } from "@/components/app/NotificationList";
import type { AgentSelfView } from "@/server/views/agent.views";
import type { computeCompletion } from "@/server/services/agent.service";
import { labelFor } from "@/lib/options";

type Props = {
  profile: AgentSelfView;
  completion: ReturnType<typeof computeCompletion>;
  notifications: Array<{ id: string; title: string; body: string; readAt: Date | null; createdAt: Date }>;
  requests: Array<{ id: string; role: string; status: string; companyName: string | null; myStatus: string; next: { scheduledAt: Date; timezone: string } | null }>;
  placements: Array<{ id: string; status: string; positionTitle: string; companyName: string }>;
};

export function AgentDashboard({ profile, completion, notifications, requests, placements }: Props) {
  const next = completion.parts.find((p) => !p.done);
  const latestFeedback = [...profile.videos, ...profile.recordings].filter((m) => m.reviewFeedback && (m.status === "REVISION_REQUIRED" || m.status === "REJECTED"));

  return (
    <>
      <PageHeader eyebrow="Talent dashboard" title={`Welcome, ${profile.displayName}`} description="Complete your profile, submit it for review, and Hirewise will represent you to vetted clients." />

      {profile.status === "REVISION_REQUIRED" && <div className="mb-6"><Banner tone="warn" title="Hirewise asked for changes">Check your notifications for the reviewer&apos;s feedback, update your profile, and submit again.</Banner></div>}
      {profile.status === "APPROVED" && <div className="mb-6"><Banner tone="success" title="Your profile is live">Vetted clients can now discover you. Keep your availability current.</Banner></div>}
      {(profile.status === "SUBMITTED" || profile.status === "UNDER_REVIEW") && <div className="mb-6"><Banner tone="info" title="Under Hirewise review">Submitted {fmtDate(profile.submittedAt)}. You will be notified when the review is complete.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Profile completion" className="lg:col-span-2">
          <div className="flex items-end justify-between">
            <p className="font-display text-[3rem] font-extrabold leading-none text-ink-900">{completion.total}%</p>
            <div className="flex gap-2">
              <StatusBadge status={profile.status} />
              <StatusBadge status={profile.verificationLevel} />
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all" style={{ width: `${completion.total}%` }} />
          </div>
          <ul className="mt-5 divide-y divide-ink-100">
            {completion.parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 py-2.5">
                <span className="flex items-center gap-3 text-[14.5px]">
                  {p.done ? <Check className="h-4 w-4 text-brand-600" /> : <Circle className="h-4 w-4 text-ink-300" />}
                  <span className={p.done ? "text-ink-500 line-through decoration-ink-300" : "font-medium text-ink-800"}>{p.label}</span>
                  <span className="text-[12px] text-ink-400">{p.weight}%</span>
                </span>
                {!p.done && (
                  <Link href={p.href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
                    Complete <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            {next ? (
              <Link href={next.href} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[14.5px] font-semibold text-white hover:bg-ink-800">
                Next: {next.label} <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link href="/profile" className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-500 px-5 text-[14.5px] font-semibold text-white hover:bg-brand-600">
                Review and submit <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <Link href="/profile" className="inline-flex h-11 items-center rounded-full border border-ink-200 bg-white px-5 text-[14.5px] font-semibold text-ink-800 hover:bg-ink-50">
              Open profile
            </Link>
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Status">
            <dl className="space-y-3 text-[14px]">
              <Row k="Profile" v={labelFor(profile.status)} />
              <Row k="Verification" v={labelFor(profile.verificationLevel)} />
              <Row k="Availability" v={labelFor(profile.availabilityStatus)} />
              <Row k="Video" v={profile.videos[0] ? labelFor(profile.videos[0].status) : "Not uploaded"} />
              <Row k="Voice samples" v={profile.recordings.length ? `${profile.recordings.filter((r) => r.status === "APPROVED").length}/${profile.recordings.length} approved` : "None"} />
              <Row k="Client rate" v={profile.clientRatePublished ? "Published by Hirewise" : "Not yet published"} />
              <Row k="Certifications" v={profile.certifications.filter((c) => c.status === "APPROVED").length ? profile.certifications.filter((c) => c.status === "APPROVED").map((c) => c.name).join(", ") : "None yet"} />
              <Row k="Courses" v={profile.courses.length ? `${profile.courses.filter((c) => c.status === "COMPLETED").length}/${profile.courses.length} completed` : "Browse the Academy"} />
            </dl>
          </Card>
          <Card title="Interviews and placements" actions={<Link href="/interviews" className="text-[13px] font-semibold text-brand-600">All</Link>}>
            {requests.length === 0 && placements.length === 0 ? <EmptyState title="No interview requests yet" /> : (
              <ul className="divide-y divide-ink-100 text-[13.5px]">
                {placements.map((p) => <li key={p.id} className="py-2"><span className="font-semibold text-ink-800">{p.positionTitle} at {p.companyName}</span> <span className="text-ink-500">· placement {labelFor(p.status).toLowerCase()}</span></li>)}
                {requests.filter((r) => !["CLOSED", "CANCELLED"].includes(r.status)).map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={`/interviews/${r.id}`} className="font-semibold text-ink-800 hover:text-brand-700">{r.role}{r.companyName ? ` at ${r.companyName}` : ""}</Link>
                    <span className="text-ink-500"> · {labelFor(r.status).toLowerCase()}{r.status === "CANDIDATE_CONFIRMATION" && r.myStatus === "PENDING" ? " · please confirm" : ""}{r.next ? ` · ${new Date(r.next.scheduledAt).toLocaleString("en-US", { timeZone: r.next.timezone, dateStyle: "medium", timeStyle: "short" })}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Certifications" description="Issued by the Hirewise VA Academy (Phase 3).">
            <EmptyState title="No certifications yet" description="Academy courses and coach assessments arrive in Phase 3." />
          </Card>
        </div>
      </div>

      {latestFeedback.length > 0 && (
        <div className="mt-6">
          <Card title="Reviewer feedback on your media">
            <ul className="space-y-2 text-[14px] text-ink-700">
              {latestFeedback.map((m) => (
                <li key={m.id} className="rounded-xl bg-gold-50 px-4 py-3"><span className="font-semibold">{labelFor(m.status)}:</span> {m.reviewFeedback}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card title="Notifications" actions={<Link href="/notifications" className="text-[13px] font-semibold text-brand-600">View all</Link>}>
          <NotificationList items={notifications.slice(0, 5)} compact />
        </Card>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="font-semibold text-ink-800">{v}</dd>
    </div>
  );
}
