import type { Db } from "@/server/db/types";

export const categoryRepository = {
  list(db: Db, activeOnly: boolean) {
    return db.courseCategory.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: [{ order: "asc" }, { name: "asc" }], include: { _count: { select: { courses: true } } } });
  },
  findById(db: Db, id: string) {
    return db.courseCategory.findUnique({ where: { id } });
  },
  findByName(db: Db, name: string) {
    return db.courseCategory.findUnique({ where: { name } });
  },
  create(db: Db, d: { name: string; slug: string; order: number; isActive: boolean }) {
    return db.courseCategory.create({ data: d });
  },
  update(db: Db, id: string, d: { name: string; slug: string; order: number; isActive: boolean }) {
    return db.courseCategory.update({ where: { id }, data: d });
  },
};
