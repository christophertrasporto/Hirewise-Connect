import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { ResumeUpload } from "@/components/profile/ResumeUpload";

export const metadata: Metadata = { title: "Résumé" };

export default async function ResumePage() {
  const actor = await requireActor();
  const p = await getOwnProfile(prisma, actor);
  return (
    <>
      <PageHeader title="Résumé" description="Your résumé is private to Hirewise. Clients see the structured profile, not the file." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Upload">
          {p.privateContact?.hasResume && <div className="mb-4"><Banner tone="success" title="Résumé on file">Uploading a new file replaces it.</Banner></div>}
          <ResumeUpload agentProfileId={p.id} hasResume={!!p.privateContact?.hasResume} />
        </Card>
        <Card title="Profile photo">
          <ResumeUpload agentProfileId={p.id} hasResume={false} photo />
        </Card>
      </div>
    </>
  );
}
