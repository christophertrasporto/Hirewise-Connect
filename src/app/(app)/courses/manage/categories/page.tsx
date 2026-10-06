import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { listCategories } from "@/server/services/category.service";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { CategoryAdmin } from "@/components/academy/CategoryAdmin";

export const metadata: Metadata = { title: "Course categories" };

export default async function CategoriesPage() {
  const actor = await requireActor();
  if (!can(actor, "course.manage")) return <Banner tone="warn" title="Requires course.manage">Categories are managed by Admins.</Banner>;
  const rows = await listCategories(prisma, { includeInactive: true });
  return (
    <>
      <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader eyebrow="Courses" title="Categories" description="Every course belongs to one category. Add, rename, reorder, or deactivate; deactivated categories stay on existing courses but cannot be chosen for new ones." />
      <Card>
        <CategoryAdmin rows={rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, order: r.order, isActive: r.isActive, courseCount: r._count.courses }))} />
      </Card>
    </>
  );
}
