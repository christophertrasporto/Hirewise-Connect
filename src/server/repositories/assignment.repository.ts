import type { SubmissionStatus, SubmissionType } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type SubmissionWrite = { submissionType: SubmissionType; text: string | null; url: string | null; storageKey: string | null; fileName: string | null };

export const assignmentRepository = {
  latestFor(db: Db, lessonId: string, agentProfileId: string) {
    return db.assignmentSubmission.findFirst({ where: { lessonId, agentProfileId }, orderBy: { submittedAt: "desc" } });
  },

  listFor(db: Db, lessonId: string, agentProfileId: string) {
    return db.assignmentSubmission.findMany({ where: { lessonId, agentProfileId }, orderBy: { submittedAt: "desc" } });
  },

  /** Latest submission per assignment lesson for one learner (course page). */
  async latestByLesson(db: Db, lessonIds: string[], agentProfileId: string) {
    if (!lessonIds.length) return [];
    const rows = await db.assignmentSubmission.findMany({ where: { lessonId: { in: lessonIds }, agentProfileId }, orderBy: { submittedAt: "desc" } });
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.lessonId) ? false : (seen.add(r.lessonId), true)));
  },

  create(db: Db, lessonId: string, agentProfileId: string, d: SubmissionWrite) {
    return db.assignmentSubmission.create({ data: { lessonId, agentProfileId, ...d } });
  },

  find(db: Db, id: string) {
    return db.assignmentSubmission.findUnique({ where: { id }, include: { lesson: { select: { id: true, title: true, points: true, dueAt: true, submissionType: true, module: { select: { courseId: true } } } }, agentProfile: { select: { id: true, displayName: true, userId: true } } } });
  },

  review(db: Db, id: string, d: { status: SubmissionStatus; grade: number | null; feedback: string | null; reviewedById: string }) {
    return db.assignmentSubmission.update({ where: { id }, data: { ...d, reviewedAt: new Date() } });
  },

  awaitingReview(db: Db, courseId: string) {
    return db.assignmentSubmission.findMany({ where: { status: "SUBMITTED", lesson: { module: { courseId } } }, include: { lesson: { select: { id: true, title: true, points: true, dueAt: true, submissionType: true } }, agentProfile: { select: { id: true, displayName: true } } }, orderBy: { submittedAt: "asc" } });
  },

  countAwaitingReview(db: Db, courseId: string) {
    return db.assignmentSubmission.count({ where: { status: "SUBMITTED", lesson: { module: { courseId } } } });
  },
};
