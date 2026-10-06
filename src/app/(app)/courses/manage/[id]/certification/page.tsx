import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { listTemplatesForAdmin } from "@/server/services/academy.service";
import { Card, Banner } from "@/components/app/ui";
import { CertificationTemplateForm } from "@/components/academy/CertificationTemplateForm";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Certification" };

export default async function CertificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, course } = await loadBuilderCourse(id);
  const isAdmin = actor.permissions.has("course.manage");
  const templates = isAdmin ? await listTemplatesForAdmin(prisma, actor) : [];
  const finalAssessment = [...course.modules.flatMap((m) => m.lessons)].reverse().find((l) => l.contentType === "ASSESSMENT");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card title="Certification template" description="The certification issued when a learner meets the completion rules. Linking a template is an Admin step; it can also be done at publish time.">
          {isAdmin ? (
            <CertificationTemplateForm courseId={course.id} current={course.certificationTemplate?.id ?? null} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
          ) : (
            <p className="text-[14px] text-ink-600">{course.certificationTemplate ? `Linked: ${course.certificationTemplate.name}.` : "No certification template linked yet. Admin links one when publishing."}</p>
          )}
        </Card>
        <Card title="What a learner must do">
          <ul className="space-y-2 text-[14px] text-ink-700">
            <li>1. Complete every required lesson ({course.modules.flatMap((m) => m.lessons).filter((l) => l.isRequired && l.status === "PUBLISHED").length} published).</li>
            <li>2. {course.completionRequiresQuizPass ? "Pass every required quiz, assessment, and audiobook quiz." : "Quiz passes are not required for completion."}</li>
            <li>3. {course.completionRequiresFinalAssessment ? (finalAssessment ? `Pass the final assessment "${finalAssessment.title}".` : "Pass the final assessment (add an Assessment lesson).") : "No final assessment required."}</li>
            <li>4. {course.requiresCoachReview ? "Receive a coach assessment before the certification is issued." : "Certification is issued automatically on completion."}</li>
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-400">Change these under <Link href={`/courses/manage/${course.id}/settings`} className="font-semibold text-brand-600">Settings</Link> and <Link href={`/courses/manage/${course.id}`} className="font-semibold text-brand-600">Overview</Link>.</p>
        </Card>
      </div>
      <div className="space-y-5">
        <Banner tone="info" title="Certificates carry a number">Issued certificates get a certificate number and a verification code and appear on the learner&apos;s profile. Issuing by completion rules arrives in the progress phase.</Banner>
      </div>
    </div>
  );
}
