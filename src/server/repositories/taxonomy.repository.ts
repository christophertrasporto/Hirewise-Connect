import type { Db } from "@/server/db/types";

export const taxonomyRepository = {
  activeSkills(db: Db) {
    return db.skill.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  },
  activeSoftware(db: Db) {
    return db.software.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  },
  skillIdsExist(db: Db, ids: string[]) {
    return db.skill.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  },
  softwareIdsExist(db: Db, ids: string[]) {
    return db.software.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  },
};
