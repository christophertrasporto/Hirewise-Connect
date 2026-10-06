import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { quizRepository } from "@/server/repositories/quiz.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { recalculateCourseProgress } from "./progress.service";

/**
 * Real-listening tracking for audio (and uploaded video) lessons (Course Builder phase 4).
 * The player reports seconds actually played since its previous report; the server credits at most the
 * wall-clock time that passed (times playback rate, plus slack), so opening the lesson or dragging the
 * playhead to the end never completes it. State lives in LessonProgress, so it follows the learner across devices.
 */
export const MEDIA_LESSON_TYPES = ["AUDIO", "VIDEO"] as const;
export const DEFAULT_REQUIRED_PERCENT = 90;

/** The six audiobook statuses from the spec, derived from LessonProgress and the quiz attempts. */
export const AUDIO_STATUSES = ["NOT_STARTED", "LISTENING", "AUDIO_COMPLETE", "QUIZ_PENDING", "QUIZ_FAILED", "COMPLETED"] as const;
export type AudioStatus = (typeof AUDIO_STATUSES)[number];
export const AUDIO_STATUS_LABELS: Record<AudioStatus, string> = { NOT_STARTED: "Not started", LISTENING: "Listening", AUDIO_COMPLETE: "Audio complete", QUIZ_PENDING: "Quiz pending", QUIZ_FAILED: "Quiz failed", COMPLETED: "Completed" };

export const mediaReportSchema = z.object({
  positionSec: z.coerce.number().min(0),
  /** Seconds actually played since the previous report (the client sums timeupdate deltas and ignores seeks). */
  playedDeltaSec: z.coerce.number().min(0).max(60),
  durationSec: z.coerce.number().positive().optional(),
  /** Wall-clock ms since the previous report; caps the credited delta so a tampered client cannot fast-forward. */
  elapsedMs: z.coerce.number().min(0).optional(),
  playbackRate: z.coerce.number().min(0.25).max(2).optional(),
});
export type MediaReport = z.input<typeof mediaReportSchema>;

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent track lesson progress");
  return actor.agentProfileId;
}

type MediaLesson = NonNullable<Awaited<ReturnType<typeof quizRepository.findQuizLesson>>>;

async function learnerMediaLesson(db: PrismaClient, actor: Actor, lessonId: string) {
  const profileId = ownProfileId(actor);
  const lesson = await quizRepository.findQuizLesson(db, lessonId);
  if (!lesson || lesson.status !== "PUBLISHED" || lesson.module.status !== "PUBLISHED") throw new NotFoundError();
  if (!(MEDIA_LESSON_TYPES as readonly string[]).includes(lesson.contentType)) throw new NotFoundError();
  const enrollment = await academyRepository.findEnrollment(db, lesson.module.courseId, profileId);
  if (!enrollment) throw new NotFoundError();
  if (enrollment.paymentStatus === "PENDING") throw new ForbiddenError("This course unlocks once Hirewise records your payment.");
  return { profileId, lesson, enrollment };
}

export function audioStatusOf(p: { progress: { status: string; mediaSeconds: number; mediaCompletedAt: Date | null } | null; questionCount: number; latestAttempt: { status: string } | null }): AudioStatus {
  if (!p.progress || (p.progress.status === "NOT_STARTED" && p.progress.mediaSeconds === 0)) return "NOT_STARTED";
  if (p.progress.status === "COMPLETED") return "COMPLETED";
  if (!p.progress.mediaCompletedAt) return "LISTENING";
  if (p.questionCount === 0) return "AUDIO_COMPLETE";
  if (p.progress.status === "RETAKE_REQUIRED" || p.progress.status === "FAILED") return "QUIZ_FAILED";
  if (p.progress.status === "PENDING_REVIEW" || (p.latestAttempt && (p.latestAttempt.status === "IN_PROGRESS" || p.latestAttempt.status === "PENDING_REVIEW"))) return "QUIZ_PENDING";
  return "AUDIO_COMPLETE";
}

async function buildState(db: PrismaClient, lesson: MediaLesson, profileId: string) {
  const progress = await quizRepository.progress(db, lesson.id, profileId);
  const questionCount = lesson.contentType === "AUDIO" ? (await quizRepository.listForLesson(db, lesson.id, "PUBLISHED")).length : 0;
  const latestAttempt = questionCount ? ((await quizRepository.attemptsFor(db, lesson.id, profileId))[0] ?? null) : null;
  const requiredPercent = lesson.requiredPercent ?? DEFAULT_REQUIRED_PERCENT;
  return {
    lessonId: lesson.id,
    courseId: lesson.module.courseId,
    contentType: lesson.contentType,
    durationSec: lesson.durationSec,
    requiredPercent,
    percent: progress?.mediaPercent ?? 0,
    mediaSeconds: progress?.mediaSeconds ?? 0,
    lastPositionSec: progress?.lastPositionSec ?? 0,
    startedAt: progress?.startedAt ?? null,
    audioCompletedAt: progress?.mediaCompletedAt ?? null,
    completedAt: progress?.completedAt ?? null,
    status: progress?.status ?? "NOT_STARTED",
    questionCount,
    quizUnlocked: !!progress?.mediaCompletedAt && questionCount > 0,
    audioStatus: audioStatusOf({ progress: progress ? { status: progress.status, mediaSeconds: progress.mediaSeconds, mediaCompletedAt: progress.mediaCompletedAt } : null, questionCount, latestAttempt }),
  };
}
export type MediaState = Awaited<ReturnType<typeof buildState>>;

/** Where the learner is on this audio or video lesson: resume position, listened share, quiz gate. */
export async function mediaStateForLearner(db: PrismaClient, actor: Actor, lessonId: string): Promise<MediaState> {
  const { profileId, lesson } = await learnerMediaLesson(db, actor, lessonId);
  return buildState(db, lesson, profileId);
}

/**
 * Progress beacon. Credits real playback only; when the listened share reaches the lesson's required percent the
 * audio part is complete: an audio lesson without questions (or a video lesson) completes outright and course
 * progress is recalculated, an audiobook with questions unlocks its quiz and completes when the quiz is passed.
 */
export async function recordMediaProgress(db: PrismaClient, actor: Actor, lessonId: string, raw: MediaReport): Promise<MediaState> {
  const { profileId, lesson } = await learnerMediaLesson(db, actor, lessonId);
  const input = mediaReportSchema.parse(raw);
  const existing = await quizRepository.progress(db, lesson.id, profileId);
  // The coach-side duration (read from the uploaded file) wins over whatever the client claims.
  const durationSec = lesson.durationSec ?? input.durationSec ?? null;
  const rate = Math.min(2, input.playbackRate ?? 1);
  const cap = input.elapsedMs === undefined ? 60 : Math.min(60, (input.elapsedMs / 1000) * rate + 2);
  const credited = Math.min(input.playedDeltaSec, cap);
  const mediaSeconds = Math.min((existing?.mediaSeconds ?? 0) + credited, durationSec ? durationSec * 1.05 : Number.MAX_SAFE_INTEGER);
  const percent = durationSec ? Math.min(100, Math.floor((mediaSeconds / durationSec) * 100)) : 0;
  const requiredPercent = lesson.requiredPercent ?? DEFAULT_REQUIRED_PERCENT;
  const nowAudioDone = !existing?.mediaCompletedAt && durationSec !== null && percent >= requiredPercent;
  const questionCount = lesson.contentType === "AUDIO" ? (await quizRepository.listForLesson(db, lesson.id, "PUBLISHED")).length : 0;
  const completesLesson = nowAudioDone && questionCount === 0 && !existing?.completedAt;
  await db.$transaction(async (tx) => {
    await quizRepository.upsertProgress(tx, lesson.id, profileId, {
      status: completesLesson ? "COMPLETED" : existing ? undefined : "IN_PROGRESS",
      mediaSeconds,
      lastPositionSec: durationSec ? Math.min(input.positionSec, durationSec) : input.positionSec,
      mediaPercent: percent,
      mediaCompletedAt: nowAudioDone ? new Date() : undefined,
      completedAt: completesLesson ? new Date() : undefined,
      lessonVersion: lesson.version,
    });
    if (nowAudioDone) {
      await audit(tx, { actor, action: "LESSON_MEDIA_COMPLETED", entityType: "CourseLesson", entityId: lesson.id, newValue: { courseId: lesson.module.courseId, contentType: lesson.contentType, percent, mediaSeconds: Math.round(mediaSeconds), durationSec, requiredPercent, lessonCompleted: completesLesson, quizUnlocked: questionCount > 0 } });
    }
    if (completesLesson) await recalculateCourseProgress(tx, lesson.module.courseId, profileId);
  });
  return buildState(db, lesson, profileId);
}
