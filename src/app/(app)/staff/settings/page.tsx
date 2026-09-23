import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listSettings } from "@/server/services/launch.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { SettingForm } from "@/components/launch/LaunchForms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  let rows: Awaited<ReturnType<typeof listSettings>>;
  try {
    rows = await listSettings(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires settings.manage">Platform settings are for the Super Admin.</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Administration" title="Platform settings" description="Section 14 defaults and operational thresholds. Every change is audited with the previous value." />
      <Card><div className="divide-y divide-ink-100">{rows.map((s) => <SettingForm key={s.key} setting={s} />)}</div></Card>
    </>
  );
}
