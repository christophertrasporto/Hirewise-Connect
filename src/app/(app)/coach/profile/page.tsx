import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnCoachProfile } from "@/server/services/coach-profile.service";
import { PageHeader, Card } from "@/components/app/ui";
import { CoachProfileForm } from "@/components/academy/CoachProfileForm";
import { userRepository } from "@/server/repositories/user.repository";

export const metadata: Metadata = { title: "Coach profile" };

export default async function CoachProfilePage() {
  const actor = await requireActor();
  const profile = await getOwnCoachProfile(prisma, actor);
  const me = await userRepository.findForActor(prisma, actor.userId);
  return (
    <>
      <PageHeader eyebrow="Courses" title="Coach profile" description="The name and short bio learners see on your courses. Without a profile, learners see the first part of your email address." />
      <div className="max-w-2xl">
        <Card>
          <CoachProfileForm profile={profile} suggestedName={me?.email.split("@")[0] ?? ""} />
        </Card>
      </div>
    </>
  );
}
