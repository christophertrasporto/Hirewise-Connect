import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { CourseForm } from "@/components/academy/CourseForm";

export const metadata: Metadata = { title: "New course" };

export default async function NewCoursePage() {
  const actor = await requireActor();
  if (!can(actor, "course.create_own") && !can(actor, "course.manage")) return <Banner tone="warn" title="Coaches only">You need the coach role to create courses.</Banner>;
  return (
    <>
      <Link href="/coach" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Coach console</Link>
      <PageHeader eyebrow="New course" title="Create a course" description="Describe the course and set its price in USD. Next you will build the exam, then submit the course to Admin for publishing." />
      <Card><CourseForm /></Card>
    </>
  );
}
