import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assignmentRepository } from "@/server/repositories/assignment.repository";
import { quizRepository } from "@/server/repositories/quiz.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { rateLimit } from "@/server/auth/rate-limit";
import { loadEditableCourse, LESSON_UPLOAD_RULES } from "./academy.service";
import { recalculateCourseProgress, assertLessonUnlocked } from "./progress.service";
import { toSubmissionLearnerView } from "@/server/views/academy.views";

/**
 * Assignments (Course Builder phase 5): the learner submits text, a URL, or a document per the lesson's submission
 * type; the coach grades it, writes feedback, and either marks the lesson complete or returns it for another try.
 * Submissions are append-only history: a returned assignment is answered with a new submission.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const submissionSchema = z.object({
  text: optionalText(20000),
  url: z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal("")),
  storageKey: optionalText(300),
  fileName: optionalText(200),
});
export type SubmissionInput = z.input<typeof submissionSchema>;

/** Document lesson types plus images and zip archives. Built lazily: academy.service imports this module. */
const submissionMimes = (): Record<string, string> => ({ ...LESSON_UPLOAD_RULES.DOCUMENT.mimes, "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/zip": "zip" });
const SUBMISSION_MAX_BYTES = 50 * 1024 * 1024;

export const submissionUploadRequestSchema = z.object({ contentType: z.string().min(1), sizeBytes: z.coerce.number().int().positive(), fileName: z.string().trim().max(200).optional() });

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent submit assignments");
  return actor.agentProfileId;
}

async function learnerAssignment(db: PrismaClient, actor: Actor, lessonId: string) {
  const profileId = ownProfileId(actor);
  const lesson = await quizRepository.findQuizLesson(db, lessonId);
  if (!lesson || lesson.contentType !== "ASSIGNMENT" || lesson.status !== "PUBLISHED" || lesson.module.status !== "PUBLISHED") throw new NotFoundError();
  const enrollment = await academyRepository.findEnrollment(db, lesson.module.courseId, profileId);
  if (!enrollment) throw new NotFoundError();
  if (enrollment.paymentStatus === "PENDING") throw new ForbiddenError("This course unlocks once Hirewise records your payment.");
  await assertLessonUnlocked(db, lesson, profileId);
  return { profileId, lesson };
}

const submissionPrefix = (courseId: string, profileId: string) => `courses/${courseId}/submissions/${profileId}/`;

/** Step 1 of a document submission: a presigned PUT scoped to the learner's folder under the course. */
export async function createSubmissionUploadUrl(db: PrismaClient, actor: Actor, lessonId: string, raw: z.input<typeof submissionUploadRequestSchema>) {
  const { profileId, lesson } = await learnerAssignment(db, actor, lessonId);
  const input = submissionUploadRequestSchema.parse(raw);
  rateLimit(`submission-upload:${actor.userId}`, 30, 60 * 60_000);
  const ext = submissionMimes()[input.contentType];
  if (!ext) throw new Error(`Unsupported file type: ${input.contentType}. Upload a PDF, Word, PowerPoint, Excel, text, image, or zip file.`);
  if (input.sizeBytes > SUBMISSION_MAX_BYTES) throw new Error("File is too large. Maximum is 50 MB.");
  const key = newStorageKey(`${submissionPrefix(lesson.module.courseId, profileId)}${lesson.id}`, ext);
  const upload = await getStorage().createUploadUrl(key, input.contentType);
  return { key, ...upload };
}

export async function submitAssignment(db: PrismaClient, actor: Actor, lessonId: string, raw: SubmissionInput) {
  const { profileId, lesson } = await learnerAssignment(db, actor, lessonId);
  const input = submissionSchema.parse(raw);
  const type = lesson.submissionType ?? "OTHER";
  const has = (v: string | undefined) => !!v && v !== "";
  if (type === "TEXT" && !has(input.text)) throw Object.assign(new Error("Write your answer."), { name: "UploadRejectedError", field: "text" });
  if (type === "URL" && !has(input.url)) throw Object.assign(new Error("Paste the link to your work."), { name: "UploadRejectedError", field: "url" });
  if (type === "DOCUMENT" && !has(input.storageKey)) throw Object.assign(new Error("Upload your file."), { name: "UploadRejectedError", field: "storageKey" });
  if (type === "OTHER" && !has(input.text) && !has(input.url) && !has(input.storageKey)) throw Object.assign(new Error("Add a note, a link, or a file."), { name: "UploadRejectedError", field: "text" });
  if (has(input.storageKey)) {
    if (!input.storageKey!.startsWith(submissionPrefix(lesson.module.courseId, profileId))) throw new ForbiddenError("Storage key does not belong to this assignment");
    if (!(await getStorage().exists(input.storageKey!))) throw new Error("The file was not uploaded. Try again.");
  }
  const latest = await assignmentRepository.latestFor(db, lesson.id, profileId);
  if (latest?.status === "SUBMITTED") throw new Error("Your submission is already with your coach. Wait for their review before sending another.");
  if (latest?.status === "GRADED") throw new Error("This assignment has already been graded.");
  const late = !!lesson.dueAt && Date.now() > lesson.dueAt.getTime();
  return db.$transaction(async (tx) => {
    const s = await assignmentRepository.create(tx, lesson.id, profileId, { submissionType: type, text: has(input.text) ? input.text! : null, url: has(input.url) ? input.url! : null, storageKey: has(input.storageKey) ? input.storageKey! : null, fileName: has(input.fileName) ? input.fileName! : null });
    const progress = await quizRepository.progress(tx, lesson.id, profileId);
    if (!progress?.completedAt) await quizRepository.upsertProgress(tx, lesson.id, profileId, { status: "PENDING_REVIEW", lessonVersion: lesson.version });
    await audit(tx, { actor, action: "ASSIGNMENT_SUBMITTED", entityType: "AssignmentSubmission", entityId: s.id, newValue: { lessonId: lesson.id, courseId: lesson.module.courseId, submissionType: type, late, resubmission: !!latest } });
    return { id: s.id, late };
  });
}

/** The learner's own submission history for one assignment, latest first. */
export async function mySubmissions(db: PrismaClient, actor: Actor, lessonId: string) {
  const { profileId, lesson } = await learnerAssignment(db, actor, lessonId);
  const rows = await assignmentRepository.listFor(db, lesson.id, profileId);
  return rows.map(toSubmissionLearnerView);
}


/** Course-level gate for reviewing: Admin, or an assigned coach with assignment.review. */
async function reviewer(db: PrismaClient, actor: Actor, courseId: string) {
  const course = await loadEditableCourse(db, actor, courseId);
  if (!actor.permissions.has("course.manage")) authorize(actor, "assignment.review");
  return course;
}

export async function submissionsAwaitingReview(db: PrismaClient, actor: Actor, courseId: string) {
  const course = await reviewer(db, actor, courseId);
  const rows = await assignmentRepository.awaitingReview(db, course.id);
  return rows.map((s) => ({ id: s.id, lesson: s.lesson, learner: s.agentProfile, submissionType: s.submissionType, text: s.text, url: s.url, fileName: s.fileName, hasFile: !!s.storageKey, submittedAt: s.submittedAt, late: !!s.lesson.dueAt && s.submittedAt.getTime() > s.lesson.dueAt.getTime() }));
}

export const reviewSubmissionSchema = z.object({
  decision: z.enum(["GRADED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).optional().or(z.literal("")),
  feedback: optionalText(4000),
});

/** Grade and complete, or return for changes with feedback. Completing recalculates course progress. */
export async function reviewSubmission(db: PrismaClient, actor: Actor, courseId: string, submissionId: string, raw: z.input<typeof reviewSubmissionSchema>) {
  const course = await reviewer(db, actor, courseId);
  const input = reviewSubmissionSchema.parse(raw);
  const s = await assignmentRepository.find(db, submissionId);
  if (!s || s.lesson.module.courseId !== course.id) throw new NotFoundError();
  if (s.status !== "SUBMITTED") throw new Error("This submission has already been reviewed.");
  const max = s.lesson.points ?? 100;
  const grade = input.grade === "" || input.grade === undefined ? null : input.grade;
  if (grade !== null && grade > max) throw Object.assign(new Error(`The grade cannot exceed ${max} points.`), { name: "UploadRejectedError", field: "grade" });
  if (input.decision === "RETURNED" && !input.feedback) throw Object.assign(new Error("Tell the learner what to change."), { name: "UploadRejectedError", field: "feedback" });
  await db.$transaction(async (tx) => {
    await assignmentRepository.review(tx, s.id, { status: input.decision, grade, feedback: input.feedback || null, reviewedById: actor.userId });
    const progress = await quizRepository.progress(tx, s.lessonId, s.agentProfileId);
    if (input.decision === "GRADED") {
      if (!progress?.completedAt) await quizRepository.upsertProgress(tx, s.lessonId, s.agentProfileId, { status: "COMPLETED", completedAt: new Date() });
    } else if (!progress?.completedAt) {
      await quizRepository.upsertProgress(tx, s.lessonId, s.agentProfileId, { status: "RETAKE_REQUIRED" });
    }
    await audit(tx, { actor, action: "ASSIGNMENT_REVIEWED", entityType: "AssignmentSubmission", entityId: s.id, newValue: { lessonId: s.lessonId, courseId: course.id, decision: input.decision, grade, maxPoints: max }, reason: input.feedback || undefined });
    if (input.decision === "GRADED") {
      await audit(tx, { actor: { userId: s.agentProfile.userId, role: "AGENT", permissions: new Set(), agentProfileId: s.agentProfileId }, action: "LESSON_COMPLETED", entityType: "CourseLesson", entityId: s.lessonId, newValue: { courseId: course.id, contentType: "ASSIGNMENT", how: "graded", reviewedBy: actor.userId } });
      await recalculateCourseProgress(tx, course.id, s.agentProfileId);
    }
  });
}

/** Signed URL for a submitted document: the learner who sent it, or a reviewer of the course. */
export async function submissionDownloadUrl(db: PrismaClient, actor: Actor, submissionId: string): Promise<string> {
  const s = await assignmentRepository.find(db, submissionId);
  if (!s?.storageKey) throw new NotFoundError();
  if (actor.role === "AGENT") {
    if (s.agentProfileId !== actor.agentProfileId) throw new NotFoundError();
  } else {
    await reviewer(db, actor, s.lesson.module.courseId);
  }
  return getStorage().createDownloadUrl(s.storageKey);
}
