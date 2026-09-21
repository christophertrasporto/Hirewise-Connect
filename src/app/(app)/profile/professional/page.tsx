import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader } from "@/components/app/ui";
import { ProfessionalForm } from "@/components/profile/ProfessionalForm";

export const metadata: Metadata = { title: "Professional information" };

export default async function ProfessionalPage() {
  const actor = await requireActor();
  const p = await getOwnProfile(prisma, actor);
  return (
    <>
      <PageHeader title="Professional information" description="This is the first thing clients read. Be specific about campaigns, tools, and results." />
      <ProfessionalForm initial={{ headline: p.headline ?? "", primaryRole: p.primaryRole ?? "", summary: p.summary ?? "", yearsExperience: p.yearsExperience ?? 0, experienceLevel: p.experienceLevel ?? "MID", industries: p.industries }} />
    </>
  );
}
