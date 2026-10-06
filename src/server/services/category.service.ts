import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { categoryRepository } from "@/server/repositories/category.repository";
import { audit } from "@/server/audit/audit";

/** Course categories are admin-managed data (course.manage); the UI never hardcodes them. */
export const categorySchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2, "Give the category a name.").max(60),
  order: z.coerce.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const slugify = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

/** Any signed-in actor may read the active list (the catalog and the builder both need it). */
export function listCategories(db: PrismaClient, opts: { includeInactive?: boolean } = {}) {
  return categoryRepository.list(db, !opts.includeInactive);
}

export async function saveCategory(db: PrismaClient, actor: Actor, raw: CategoryInput) {
  authorize(actor, "course.manage");
  const input = categorySchema.parse(raw);
  const clash = await categoryRepository.findByName(db, input.name);
  if (clash && clash.id !== input.id) throw new Error(`A category named "${input.name}" already exists.`);
  let slug = slugify(input.name);
  const existingSlug = await db.courseCategory.findUnique({ where: { slug } });
  if (existingSlug && existingSlug.id !== input.id) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  return db.$transaction(async (tx) => {
    let row;
    if (input.id) {
      const current = await categoryRepository.findById(tx, input.id);
      if (!current) throw new NotFoundError();
      row = await categoryRepository.update(tx, input.id, { name: input.name, slug, order: input.order, isActive: input.isActive });
      // keep the legacy text column in sync for courses that still carry it
      await tx.academyCourse.updateMany({ where: { categoryId: row.id }, data: { category: row.name } });
      await audit(tx, { actor, action: "SETTING_CHANGED", entityType: "CourseCategory", entityId: row.id, previousValue: { name: current.name, order: current.order, isActive: current.isActive }, newValue: { name: row.name, order: row.order, isActive: row.isActive } });
    } else {
      row = await categoryRepository.create(tx, { name: input.name, slug, order: input.order, isActive: input.isActive });
      await audit(tx, { actor, action: "SETTING_CHANGED", entityType: "CourseCategory", entityId: row.id, newValue: { name: row.name, order: row.order, isActive: row.isActive, op: "create" } });
    }
    return row;
  });
}
