import type { CourseStatus, EnrollmentStatus, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function courseInclude() {
  return {
    ownerCoach: { select: { id: true, email: true } },
    coaches: { include: { coach: { select: { id: true, email: true } } } },
    certificationTemplate: { select: { id: true, name: true } },
    exam: { include: { questions: { orderBy: { order: "asc" } } } },
    _count: { select: { enrollments: true } },
  } satisfies Prisma.AcademyCourseInclude;
}

export type CourseCreate = { code: string; title: string; category: string; description: string; syllabus: string | null; contentUrl: string | null; ownerCoachUserId: string; priceCents: number; passingScore: number; requiresCoachReview: boolean };

export const academyRepository = {
  createCourse(db: Db, d: CourseCreate) {
    return db.academyCourse.create({ data: { ...d, syllabus: d.syllabus ?? undefined, contentUrl: d.contentUrl ?? undefined, coaches: { create: { coachUserId: d.ownerCoachUserId } } }, include: courseInclude() });
  },

  updateCourse(db: Db, id: string, d: Partial<Omit<CourseCreate, "ownerCoachUserId" | "code">> & { certificationTemplateId?: string | null }) {
    return db.academyCourse.update({ where: { id }, data: { ...d, syllabus: d.syllabus === undefined ? undefined : d.syllabus, contentUrl: d.contentUrl === undefined ? undefined : d.contentUrl }, include: courseInclude() });
  },

  setCourseStatus(db: Db, id: string, status: CourseStatus, extra: { publishedById?: string; publishedAt?: Date } = {}) {
    return db.academyCourse.update({ where: { id }, data: { status, ...extra } });
  },

  findCourse(db: Db, id: string) {
    return db.academyCourse.findUnique({ where: { id }, include: courseInclude() });
  },

  findCourseByCode(db: Db, code: string) {
    return db.academyCourse.findUnique({ where: { code } });
  },

  listCourses(db: Db, where: { status?: CourseStatus[]; coachUserId?: string }, take = 200) {
    return db.academyCourse.findMany({
      where: { ...(where.status ? { status: { in: where.status } } : {}), ...(where.coachUserId ? { OR: [{ ownerCoachUserId: where.coachUserId }, { coaches: { some: { coachUserId: where.coachUserId } } }] } : {}) },
      include: courseInclude(),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take,
    });
  },

  addCoach(db: Db, courseId: string, coachUserId: string) {
    return db.courseCoach.upsert({ where: { courseId_coachUserId: { courseId, coachUserId } }, create: { courseId, coachUserId }, update: {} });
  },

  // Enrollments
  enroll(db: Db, d: { courseId: string; agentProfileId: string; priceCents: number; source?: "INTERNAL" | "ACADEMY_SYNC" }) {
    return db.courseEnrollment.create({ data: { courseId: d.courseId, agentProfileId: d.agentProfileId, priceCents: d.priceCents, paymentStatus: d.priceCents > 0 ? "PENDING" : "NOT_REQUIRED", source: d.source ?? "INTERNAL" } });
  },

  findEnrollment(db: Db, courseId: string, agentProfileId: string) {
    return db.courseEnrollment.findUnique({ where: { courseId_agentProfileId: { courseId, agentProfileId } }, include: { completion: true, attempts: { orderBy: { startedAt: "desc" } }, course: { include: courseInclude() }, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } } } });
  },

  findEnrollmentById(db: Db, id: string) {
    return db.courseEnrollment.findUnique({ where: { id }, include: { completion: true, attempts: { orderBy: { startedAt: "desc" } }, course: { include: courseInclude() }, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } } } });
  },

  listEnrollmentsForAgent(db: Db, agentProfileId: string) {
    return db.courseEnrollment.findMany({ where: { agentProfileId }, include: { course: { include: courseInclude() }, completion: true, attempts: { orderBy: { startedAt: "desc" } } }, orderBy: { enrolledAt: "desc" } });
  },

  listEnrollmentsForCourse(db: Db, courseId: string) {
    return db.courseEnrollment.findMany({ where: { courseId }, include: { agentProfile: { select: { id: true, displayName: true, primaryRole: true, userId: true } }, completion: true, attempts: { orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { enrolledAt: "desc" } });
  },

  listPendingPayments(db: Db, take = 100) {
    return db.courseEnrollment.findMany({ where: { paymentStatus: "PENDING" }, include: { course: { select: { id: true, title: true } }, agentProfile: { select: { id: true, displayName: true } } }, orderBy: { enrolledAt: "asc" }, take });
  },

  setEnrollmentStatus(db: Db, id: string, status: EnrollmentStatus) {
    return db.courseEnrollment.update({ where: { id }, data: { status } });
  },

  recordPayment(db: Db, id: string, d: { paidCents: number | null; paymentReference: string | null; waived: boolean; recordedById: string }) {
    return db.courseEnrollment.update({ where: { id }, data: { paymentStatus: d.waived ? "WAIVED" : "PAID", paidCents: d.paidCents ?? undefined, paymentReference: d.paymentReference ?? undefined, paidAt: new Date(), paymentRecordedById: d.recordedById } });
  },

  createCompletion(db: Db, d: { enrollmentId: string; examScore: number | null; source?: "INTERNAL" | "ACADEMY_SYNC"; externalRef?: string | null }) {
    return db.courseCompletion.create({ data: { enrollmentId: d.enrollmentId, examScore: d.examScore ?? undefined, source: d.source ?? "INTERNAL", externalRef: d.externalRef ?? undefined } });
  },

  // Exams
  upsertExam(db: Db, courseId: string, d: { title: string; instructions: string | null; timeLimitMin: number | null; maxAttempts: number }) {
    return db.exam.upsert({ where: { courseId }, create: { courseId, ...d, instructions: d.instructions ?? undefined, timeLimitMin: d.timeLimitMin ?? undefined }, update: { ...d, instructions: d.instructions, timeLimitMin: d.timeLimitMin } });
  },

  findExam(db: Db, courseId: string) {
    return db.exam.findUnique({ where: { courseId }, include: { questions: { orderBy: { order: "asc" } } } });
  },

  async replaceQuestions(db: Db, examId: string, questions: Array<{ prompt: string; options: string[]; correctIndex: number; points: number; explanation: string | null }>) {
    await db.examQuestion.deleteMany({ where: { examId } });
    if (questions.length) await db.examQuestion.createMany({ data: questions.map((q, i) => ({ examId, order: i + 1, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation ?? undefined })) });
  },

  setExamStatus(db: Db, examId: string, status: "DRAFT" | "PUBLISHED") {
    return db.exam.update({ where: { id: examId }, data: { status } });
  },

  createAttempt(db: Db, d: { examId: string; enrollmentId: string; expiresAt: Date | null }) {
    return db.examAttempt.create({ data: { examId: d.examId, enrollmentId: d.enrollmentId, expiresAt: d.expiresAt ?? undefined } });
  },

  findAttempt(db: Db, id: string) {
    return db.examAttempt.findUnique({ where: { id }, include: { exam: { include: { questions: { orderBy: { order: "asc" } } } }, enrollment: { include: { course: { include: courseInclude() }, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } }, completion: true } } } });
  },

  submitAttempt(db: Db, id: string, d: { answers: Prisma.InputJsonValue; scorePercent: number; passed: boolean; status: "SUBMITTED" | "EXPIRED" }) {
    return db.examAttempt.update({ where: { id }, data: { ...d, submittedAt: new Date() } });
  },

  countAttempts(db: Db, enrollmentId: string) {
    return db.examAttempt.count({ where: { enrollmentId, status: { in: ["SUBMITTED", "EXPIRED"] } } });
  },

  openAttempt(db: Db, enrollmentId: string) {
    return db.examAttempt.findFirst({ where: { enrollmentId, status: "IN_PROGRESS" } });
  },
};
