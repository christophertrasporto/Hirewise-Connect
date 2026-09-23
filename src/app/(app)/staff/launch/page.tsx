import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { launchReadiness } from "@/server/services/launch.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatTile, Banner } from "@/components/app/ui";

export const metadata: Metadata = { title: "Launch readiness" };

export default async function LaunchPage() {
  const actor = await requireActor();
  let r: Awaited<ReturnType<typeof launchReadiness>>;
  try {
    r = await launchReadiness(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires settings.manage">Launch readiness is for the Super Admin.</Banner>;
    throw e;
  }
  const Icon = ({ s }: { s: "pass" | "warn" | "fail" }) => (s === "pass" ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : s === "warn" ? <AlertTriangle className="h-5 w-5 text-gold-600" /> : <XCircle className="h-5 w-5 text-red-600" />);
  return (
    <>
      <PageHeader eyebrow="Launch prep" title="Launch readiness" description="Live checks against this environment: legal text, configuration, accounts, settings, and the worker. Fails block launch; warnings need a decision. See docs/launch-checklist.md for the deployment steps." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile label="Passing" value={r.summary.pass} />
        <StatTile label="Warnings" value={r.summary.warn} />
        <StatTile label="Blocking" value={r.summary.fail} />
      </div>
      <Card>
        <ul className="divide-y divide-ink-100">
          {r.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 py-3">
              <Icon s={c.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold text-ink-900">{c.label}</p>
                <p className="text-[13px] text-ink-500">{c.detail}</p>
              </div>
              {c.href && <Link href={c.href} className="shrink-0 text-[12.5px] font-semibold text-brand-600">Open</Link>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
