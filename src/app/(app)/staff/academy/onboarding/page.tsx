import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { onboardingAdminList, ONBOARDING_STATUS_LABELS } from "@/server/services/onboarding.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, Banner, EmptyState, StatTile, fmtDate } from "@/components/app/ui";
import { Input } from "@/components/ui/Form";
import { WelcomeVideoAdminForm } from "@/components/onboarding/WelcomeVideoAdminForm";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingAdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof onboardingAdminList>>;
  try {
    data = await onboardingAdminList(prisma, actor, sp.q);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires course.manage">Onboarding settings are for Admins.</Banner>;
    throw e;
  }
  const { config, rows, summary } = data;

  return (
    <div className="space-y-6">
      <Card title="Welcome video requirement" description={config.enabled ? `Enabled for ${config.appliesTo === "ALL" ? "all talent" : "new talent"} · ${config.requiredPercent}% required · courses ${config.lockCourses ? "locked until completed" : "not locked"}.` : "Disabled. Talent sign up without a welcome video step."}>
        <WelcomeVideoAdminForm values={{ enabled: config.enabled, title: config.title, instructions: config.instructions, videoUrl: config.videoUrl, hasFile: !!config.storageKey, fileName: config.fileName, durationSec: config.durationSec, requiredPercent: config.requiredPercent, lockCourses: config.lockCourses, appliesTo: config.appliesTo, effectiveFrom: config.effectiveFrom, videoKey: config.videoKey }} />
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={ONBOARDING_STATUS_LABELS.EMAIL_NOT_VERIFIED} value={summary.EMAIL_NOT_VERIFIED} />
        <StatTile label={ONBOARDING_STATUS_LABELS.PROFILE_INCOMPLETE} value={summary.PROFILE_INCOMPLETE} />
        <StatTile label={ONBOARDING_STATUS_LABELS.WELCOME_VIDEO_PENDING} value={summary.WELCOME_VIDEO_PENDING} />
        <StatTile label={ONBOARDING_STATUS_LABELS.ONBOARDING_COMPLETED} value={summary.ONBOARDING_COMPLETED} hint={`${summary.completedVideo} watched the current video`} />
      </div>

      <Card title="Talent onboarding status" description="Newest sign-ups first. Email verification, profile, and welcome-video progress for the current video version." actions={<form method="get" className="flex gap-2"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search by email" className="h-9 w-[220px] text-[13px]" /><button type="submit" className="h-9 rounded-full bg-ink-900 px-3.5 text-[13px] font-semibold text-white">Search</button></form>}>
        {rows.length === 0 ? <EmptyState title="No talent accounts match" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-ink-100 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  <th className="py-2 pr-3">User</th>
                  <th className="px-2 py-2">Signed up</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Profile</th>
                  <th className="px-2 py-2">Welcome video</th>
                  <th className="px-2 py-2">Completed</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-ink-50">
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold text-ink-900">{r.agentProfileId ? <Link href={`/staff/talent/${r.agentProfileId}`} className="hover:text-brand-700">{r.displayName ?? r.email}</Link> : r.displayName ?? r.email}</p>
                      <p className="text-[12px] text-ink-400">{r.email}</p>
                    </td>
                    <td className="px-2 py-2.5 text-ink-600">{fmtDate(r.createdAt)}</td>
                    <td className="px-2 py-2.5">{r.emailVerified ? <span className="inline-flex items-center gap-1 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Verified</span> : <span className="inline-flex items-center gap-1 text-gold-700"><Circle className="h-4 w-4" /> Not verified</span>}</td>
                    <td className="px-2 py-2.5 text-ink-600">{r.profileDone ? "Complete" : "Incomplete"}{r.profileStatus ? <span className="text-ink-400"> · {r.profileStatus.toLowerCase().replace(/_/g, " ")}</span> : null}</td>
                    <td className="px-2 py-2.5">
                      {!r.videoRequired ? <span className="text-ink-400">Not required</span> : (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100"><span className={`block h-full rounded-full ${r.videoCompletedAt ? "bg-brand-500" : "bg-brand-300"}`} style={{ width: `${Math.min(100, r.videoPercent)}%` }} /></span>
                          <span className="text-ink-700">{r.videoPercent}%</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-ink-600">{r.videoCompletedAt ? fmtDate(r.videoCompletedAt) : r.lastWatchedAt ? <span className="text-ink-400">last watched {fmtDate(r.lastWatchedAt)}</span> : "—"}</td>
                    <td className="px-2 py-2.5"><span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${r.status === "ONBOARDING_COMPLETED" ? "bg-brand-50 text-brand-700 ring-brand-200" : r.status === "EMAIL_NOT_VERIFIED" ? "bg-red-50 text-red-700 ring-red-200" : "bg-gold-50 text-gold-700 ring-gold-200"}`}>{r.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
