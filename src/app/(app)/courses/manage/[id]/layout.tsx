import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, StatusBadge } from "@/components/app/ui";
import { BuilderTabs } from "@/components/academy/BuilderTabs";
import { loadBuilderCourse } from "./load";

/** Course Builder frame: header, status, and the six tabs. Pages render inside. */
export default async function BuilderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { course } = await loadBuilderCourse(id);
  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader
        eyebrow={course.category}
        title={course.title}
        description={`${course.priceLabel} · ${course.modules.length} module${course.modules.length === 1 ? "" : "s"} · ${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"} · ${course.enrolledCount} enrolled`}
        actions={<div className="flex items-center gap-2"><StatusBadge status={course.status} />{course.certificationTemplate && <span className="rounded-full bg-gold-50 px-2.5 py-1 text-[11.5px] font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">{course.certificationTemplate.name}</span>}</div>}
      />
      <BuilderTabs courseId={course.id} />
      {children}
    </>
  );
}
