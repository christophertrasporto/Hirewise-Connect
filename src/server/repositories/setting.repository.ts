import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const settingRepository = {
  get(db: Db, key: string) {
    return db.setting.findUnique({ where: { key } });
  },
  upsert(db: Db, key: string, value: Prisma.InputJsonValue, updatedById: string | null) {
    return db.setting.upsert({
      where: { key },
      create: { key, value, updatedById: updatedById ?? undefined },
      update: { value, updatedById: updatedById ?? undefined },
    });
  },
};
