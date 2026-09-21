import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { PageHeader } from "@/components/app/ui";
import { SkillsForm } from "@/components/profile/SkillsForm";

export const metadata: Metadata = { title: "Skills" };

export default async function SkillsPage() {
  const actor = await requireActor();
  const [p, skills, software] = await Promise.all([getOwnProfile(prisma, actor), taxonomyRepository.activeSkills(prisma), taxonomyRepository.activeSoftware(prisma)]);
  return (
    <>
      <PageHeader title="Skills and software" description="Pick from the Hirewise taxonomy so clients can filter accurately. Choose at least three skills. Levels marked verified were confirmed by a coach assessment." />
      <SkillsForm
        skills={skills.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        software={software.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        selectedSkills={Object.fromEntries(p.skills.map((s) => [s.skillId, { level: s.level, yearsUsed: s.yearsUsed ?? 0, verified: s.verified }]))}
        selectedSoftware={Object.fromEntries(p.software.map((s) => [s.softwareId, s.level]))}
      />
    </>
  );
}
