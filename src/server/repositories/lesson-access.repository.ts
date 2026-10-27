import type { Db } from "@/server/db/types";

/** The facts the access rule needs about a lesson, and nothing a learner could use to find the file. */
export const lessonAccessRepository = {
  findLesson(db: Db, lessonId: string) {
    return db.courseLesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        status: true,
        isFreePreview: true,
        contentType: true,
        storageKey: true,
        module: { select: { id: true, status: true, courseId: true, course: { select: { id: true, status: true, ownerCoachUserId: true, coaches: { select: { coachUserId: true } } } } } },
      },
    });
  },
  findEnrollment(db: Db, courseId: string, agentProfileId: string) {
    return db.courseEnrollment.findUnique({ where: { courseId_agentProfileId: { courseId, agentProfileId } }, select: { id: true, status: true, paymentStatus: true, accessRevokedAt: true } });
  },
};
