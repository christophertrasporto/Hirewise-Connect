import type { CourseStatus, EnrollmentStatus, LessonContentType, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function courseInclude() {
  return {
    ownerCoach: { select: { id: true, email: true } },
    coaches: { include: { coach: { select: { id: true, email: true } } } },
    certificationTemplate: { select: { id: true, name: true } },
    exam: { include: { questions: { orderBy: { order: "asc" } } } },
    modules: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } },
    _count: { select: { enrollments: true } },
  } satisfies Prisma.AcademyCourseInclude;
}

export type LessonWrite = { title: string; contentType: LessonContentType; body: string | null; url: string | null; storageKey: string | null; fileName: string | null; contentMime: string | null; sizeBytes: number | null; durationSec: number | null };

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

  /**
   * Save the question list while keeping the ids of questions that still exist, so in-progress
   * attempts (answers keyed by question id) and past results stay consistent when a published exam is edited.
   */
  async syncQuestions(db: Db, examId: string, questions: Array<{ id?: string; prompt: string; options: string[]; correctIndex: number; points: number; explanation: string | null }>) {
    const existing = new Set((await db.examQuestion.findMany({ where: { examId }, select: { id: true } })).map((q) => q.id));
    const keep = questions.filter((q) => q.id && existing.has(q.id)).map((q) => q.id!);
    await db.examQuestion.deleteMany({ where: { examId, id: { notIn: keep } } });
    for (const [i, q] of questions.entries()) {
      const data = { order: i + 1, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation };
      if (q.id && existing.has(q.id)) await db.examQuestion.update({ where: { id: q.id }, data });
      else await db.examQuestion.create({ data: { examId, ...data, explanation: q.explanation ?? undefined } });
    }
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

  // Curriculum: modules and lessons
  listModules(db: Db, courseId: string) {
    return db.courseModule.findMany({ where: { courseId }, orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } });
  },

  findModule(db: Db, id: string) {
    return db.courseModule.findUnique({ where: { id }, include: { lessons: { orderBy: { order: "asc" } } } });
  },

  async createModule(db: Db, courseId: string, d: { title: string; description: string | null }) {
    const order = (await db.courseModule.count({ where: { courseId } })) + 1;
    return db.courseModule.create({ data: { courseId, order, title: d.title, description: d.description ?? undefined } });
  },

  updateModule(db: Db, id: string, d: { title: string; description: string | null }) {
    return db.courseModule.update({ where: { id }, data: d });
  },

  async deleteModule(db: Db, id: string) {
    const m = await db.courseModule.delete({ where: { id } });
    await this.renumberModules(db, m.courseId);
    return m;
  },

  async renumberModules(db: Db, courseId: string) {
    const rows = await db.courseModule.findMany({ where: { courseId }, orderBy: { order: "asc" }, select: { id: true } });
    for (const [i, r] of rows.entries()) await db.courseModule.update({ where: { id: r.id }, data: { order: i + 1 } });
  },

  async swapModuleOrder(db: Db, a: { id: string; order: number }, b: { id: string; order: number }) {
    await db.courseModule.update({ where: { id: a.id }, data: { order: -1 } });
    await db.courseModule.update({ where: { id: b.id }, data: { order: a.order } });
    await db.courseModule.update({ where: { id: a.id }, data: { order: b.order } });
  },

  findLesson(db: Db, id: string) {
    return db.courseLesson.findUnique({ where: { id }, include: { module: { select: { id: true, courseId: true, order: true } } } });
  },

  async createLesson(db: Db, moduleId: string, d: LessonWrite) {
    const order = (await db.courseLesson.count({ where: { moduleId } })) + 1;
    return db.courseLesson.create({ data: { moduleId, order, ...d } });
  },

  async updateLesson(db: Db, id: string, moduleId: string, d: LessonWrite) {
    const current = await db.courseLesson.findUniqueOrThrow({ where: { id }, select: { moduleId: true } });
    if (current.moduleId !== moduleId) {
      const order = (await db.courseLesson.count({ where: { moduleId } })) + 1;
      const row = await db.courseLesson.update({ where: { id }, data: { ...d, moduleId, order } });
      await this.renumberLessons(db, current.moduleId);
      return row;
    }
    return db.courseLesson.update({ where: { id }, data: d });
  },

  async deleteLesson(db: Db, id: string) {
    const l = await db.courseLesson.delete({ where: { id } });
    await this.renumberLessons(db, l.moduleId);
    return l;
  },

  async renumberLessons(db: Db, moduleId: string) {
    const rows = await db.courseLesson.findMany({ where: { moduleId }, orderBy: { order: "asc" }, select: { id: true } });
    for (const [i, r] of rows.entries()) await db.courseLesson.update({ where: { id: r.id }, data: { order: i + 1 } });
  },

  async swapLessonOrder(db: Db, a: { id: string; order: number }, b: { id: string; order: number }) {
    await db.courseLesson.update({ where: { id: a.id }, data: { order: -1 } });
    await db.courseLesson.update({ where: { id: b.id }, data: { order: a.order } });
    await db.courseLesson.update({ where: { id: a.id }, data: { order: b.order } });
  },
};
