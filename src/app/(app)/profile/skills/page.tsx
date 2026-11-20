import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { skillsRepository } from "@/server/repositories/skills.repository";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { PageHeader } from "@/components/app/ui";
import { SkillsForm } from "@/components/profile/SkillsForm";

export const metadata: Metadata = { title: "Skills" };

/** Skills come only from the talent's courses (shown read-only, with the course behind each). Software is the one editable list. */
export default async function SkillsPage() {
  const actor = await requireActor();
  const [p, software] = await Promise.all([getOwnProfile(prisma, actor), taxonomyRepository.activeSoftware(prisma)]);
  const sources = await skillsRepository.ownedCourseSkills(prisma, p.id);
  const coursesBySkill = new Map<string, Array<{ id: string; title: string }>>();
  for (const r of sources) coursesBySkill.set(r.skillId, [...(coursesBySkill.get(r.skillId) ?? []), r.course]);
  return (
    <>
      <PageHeader title="Skills and software" description="Your skills are earned through Hirewise courses, so every one is backed by training you took. You cannot add skills by hand." />
      <SkillsForm
        software={software.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        mine={p.skills.map((s) => ({ skillId: s.skillId, verified: s.verified, hashtag: s.hashtag, name: s.name, courses: coursesBySkill.get(s.skillId) ?? [] }))}
        selectedSoftware={Object.fromEntries(p.software.map((s) => [s.softwareId, s.level]))}
      />
    </>
  );
}
