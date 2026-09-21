import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader } from "@/components/app/ui";
import { PersonalForm } from "@/components/profile/PersonalForm";

export const metadata: Metadata = { title: "Personal information" };

export default async function PersonalPage() {
  const actor = await requireActor();
  const p = await getOwnProfile(prisma, actor);
  return (
    <>
      <PageHeader title="Personal information" description="Your legal name, phone, and address are private to Hirewise. Clients see your professional name, city, country, and timezone." />
      <PersonalForm
        initial={{
          displayName: p.displayName,
          fullLegalName: p.privateContact?.fullLegalName ?? "",
          phone: p.privateContact?.phone ?? "",
          addressLine: p.privateContact?.addressLine ?? "",
          locationCity: p.locationCity ?? "",
          locationCountry: p.locationCountry ?? "Philippines",
          timezone: p.timezone ?? "Asia/Manila",
          languages: p.languages,
          workSetup: p.workSetup ?? "REMOTE",
          preferredShift: p.preferredShift ?? "",
          equipmentSummary: p.equipmentSummary ?? "",
          internetSummary: p.internetSummary ?? "",
        }}
      />
    </>
  );
}
