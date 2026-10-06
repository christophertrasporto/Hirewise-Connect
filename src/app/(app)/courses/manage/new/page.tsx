import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { listCategories } from "@/server/services/category.service";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { CourseForm } from "@/components/academy/CourseForm";

export const metadata: Metadata = { title: "New course" };

export default async function NewCoursePage() {
  const actor = await requireActor();
  if (!can(actor, "course.create_own") && !can(actor, "course.manage")) return <Banner tone="warn" title="Coaches only">You need the coach role, or the course creation permission, to create courses.</Banner>;
  const categories = await listCategories(prisma);
  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader eyebrow="New course" title="Create a course" description="Describe the course and set its price. Next you add modules and lessons, build quizzes, then submit the course to Admin for publishing." />
      {categories.length === 0 && <div className="mb-5"><Banner tone="warn" title="No categories yet">Ask an Admin to add categories under Courses → Categories before creating a course.</Banner></div>}
      <Card><CourseForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} /></Card>
    </>
  );
}
