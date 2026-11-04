import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnCoachProfile } from "@/server/services/coach-profile.service";
import { PageHeader, Card } from "@/components/app/ui";
import { CoachProfileForm } from "@/components/academy/CoachProfileForm";
import { CoachPhotoUploader } from "@/components/academy/CoachPhotoUploader";
import { userRepository } from "@/server/repositories/user.repository";

export const metadata: Metadata = { title: "Coach profile" };

export default async function CoachProfilePage() {
  const actor = await requireActor();
  const profile = await getOwnCoachProfile(prisma, actor);
  const me = await userRepository.findForActor(prisma, actor.userId);
  const suggested = me?.email.split("@")[0] ?? "";
  return (
    <>
      <PageHeader eyebrow="Courses" title="Coach profile" description="The name, photo and short bio learners see on your coach page and your public course pages. Public pages name you only while your coach page is switched on and you have a published, listed course." />
      <div className="max-w-2xl space-y-6">
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-ink-900">Photo</h2>
          {profile ? <CoachPhotoUploader name={profile.displayName} photoUrl={profile.photoUrl} /> : <p className="text-[13.5px] text-ink-600">Save your profile below first, then you can add a photo.</p>}
        </Card>
        <Card>
          <CoachProfileForm profile={profile} suggestedName={suggested} />
        </Card>
      </div>
    </>
  );
}
