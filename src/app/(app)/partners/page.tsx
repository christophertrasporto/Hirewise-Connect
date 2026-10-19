import type { Metadata } from "next";
import Link from "next/link";
import { Users, Award, GraduationCap, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { partnerTeamsForClient } from "@/server/services/partner.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Banner, EmptyState, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Partner Teams" };

/** Client-facing Partner Teams (v2 phase 5): identities only, never the agency behind them. */
export default async function PartnerTeamsPage() {
  const actor = await requireActor();
  let teams: Awaited<ReturnType<typeof partnerTeamsForClient>>;
  try {
    teams = await partnerTeamsForClient(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Partner Teams" title="Hirewise Certified Partner Teams" description="Vetted teams whose professionals are trained, assessed, and represented by Hirewise. Every engagement, interview, and contract runs through your Hirewise account manager." />
      {teams.length === 0 ? (
        <EmptyState title="No Partner Teams yet" description="Teams appear here once their professionals are approved for the marketplace." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => (
            <article key={t.code} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/partners/${t.code}`} className="text-[17px] font-bold text-ink-900 hover:text-brand-700">{t.name}</Link>
                  <p className="text-[12.5px] text-ink-400">Partner since {fmtDate(t.memberSince)}{t.disclosed ? ` · ${t.disclosed.agencyName}` : ""}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><ShieldCheck className="h-3.5 w-3.5" /> Certified</span>
              </div>
              {t.specializations.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{t.specializations.map((s) => <span key={s} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-700">{s}</span>)}</div>}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                <div><dt className="text-ink-400">Professionals</dt><dd className="font-semibold text-ink-900"><Users className="mr-1 inline h-3.5 w-3.5" />{t.teamSize}</dd></div>
                <div><dt className="text-ink-400">Available now</dt><dd className="font-semibold text-ink-900">{t.availableNow}</dd></div>
                <div><dt className="text-ink-400">Certified</dt><dd className="font-semibold text-ink-900"><Award className="mr-1 inline h-3.5 w-3.5" />{t.certifiedMembers}</dd></div>
                <div><dt className="text-ink-400">Training completion</dt><dd className="font-semibold text-ink-900"><GraduationCap className="mr-1 inline h-3.5 w-3.5" />{t.trainingCompletionPct === null ? "—" : `${t.trainingCompletionPct}%`}</dd></div>
              </dl>
              <p className="mt-3 text-[12.5px] text-ink-500">{t.avgYearsExperience !== null ? `${t.avgYearsExperience} years average experience` : "Experience on request"}{t.certifications.length ? ` · ${t.certifications.slice(0, 3).map((c) => c.name).join(", ")}` : ""}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
