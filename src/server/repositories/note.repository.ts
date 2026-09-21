import type { NoteSubjectType, NoteVisibility } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const noteRepository = {
  create(db: Db, data: { subjectType: NoteSubjectType; subjectId: string; authorUserId: string; body: string; visibility: NoteVisibility; pinned?: boolean }) {
    return db.adminNote.create({ data });
  },

  listForSubject(db: Db, subjectType: NoteSubjectType, subjectId: string, visibilities: NoteVisibility[]) {
    return db.adminNote.findMany({ where: { subjectType, subjectId, visibility: { in: visibilities } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] });
  },

  authorsByIds(db: Db, ids: string[]) {
    return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: { select: { key: true } } } });
  },
};
