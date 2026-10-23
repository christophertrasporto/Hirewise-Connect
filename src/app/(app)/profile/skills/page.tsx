import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { skillsRepository } from "@/server/repositories/skills.repository";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { PageHeader } from "@/components/app/ui";
import { SkillsForm } from "@/components/profile/SkillsForm";

export const metadata: Metadata = { title: "Skills" };

type TagRow = Awaited<ReturnType<typeof skillsRepository.listTags>>[number];
/** The published course(s) that earn the badge for a tag, for the "Want to verify this skill?" link. */
function coursesToVerify(t: TagRow): Array<{ id: string; title: string }> {
  if (t.verificationMode === "REQUIRED_COURSE") return t.requiredCourse && t.requiredCourse.status === "PUBLISHED" ? [{ id: t.requiredCourse.id, title: t.requiredCourse.title }] : [];
  if (t.verificationMode === "ANY_COURSE") return t.courses.filter((c) => c.course.status === "PUBLISHED").map((c) => ({ id: c.course.id, title: c.course.title }));
  return [];
}

/** Skills system: declared hashtags plus the derived Verified by Hirewise section. */
export default async function SkillsPage() {
  const actor = await requireActor();
  const [p, tags, software] = await Promise.all([getOwnProfile(prisma, actor), skillsRepository.listTags(prisma, true), taxonomyRepository.activeSoftware(prisma)]);
  return (
    <>
      <PageHeader title="Skills and software" description="Skill tags are self-declared and searchable. The Verified by Hirewise badge is earned only through Hirewise courses, assessments, or pathways." />
      <SkillsForm
        tags={tags.map((t) => ({ id: t.id, name: t.name, hashtag: t.hashtag ?? `#${t.name.replace(/\s+/g, "")}`, category: t.category, verifiable: t.verificationMode !== "NONE", courses: coursesToVerify(t) }))}
        software={software.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        mine={p.skills.map((s) => ({ skillId: s.skillId, verified: s.verified, verifiedAt: s.verifiedAt, hashtag: s.hashtag, name: s.name, verifiable: s.verifiable }))}
        selectedSoftware={Object.fromEntries(p.software.map((s) => [s.softwareId, s.level]))}
      />
    </>
  );
}
