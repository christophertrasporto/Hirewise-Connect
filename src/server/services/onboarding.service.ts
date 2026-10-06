import { z } from "zod";
import { creditPlayback } from "./media-credit";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { getSetting, type SettingValue } from "./setting.service";
import { settingRepository } from "@/server/repositories/setting.repository";
import { onboardingRepository } from "@/server/repositories/onboarding.repository";
import { audit } from "@/server/audit/audit";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { rateLimit } from "@/server/auth/rate-limit";
import { logger } from "@/server/logger";

/**
 * Sign-up onboarding for talent (Section 8.2 extension, 2026-10):
 *   Verify email → complete profile → watch the welcome video → courses unlock.
 * The welcome video is configured by Admin (course.manage). Completion requires actually played time
 * reaching the configured percentage; dragging the slider to the end does not count.
 */
export type WelcomeVideoConfig = SettingValue<"onboardingWelcomeVideo">;
export const WELCOME_VIDEO_SETTING = "onboardingWelcomeVideo" as const;
export const PROFILE_COMPLETE_PERCENT = 60;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const welcomeVideoConfigSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1, "Give the video a title.").max(160),
  instructions: optionalText(4000),
  videoUrl: z.string().trim().url("Enter a full URL to a video file (mp4 or webm).").optional().or(z.literal("")),
  /** New upload key from createWelcomeVideoUploadUrl, KEEP to keep the stored file, or empty to remove it. */
  storageKey: z.string().trim().max(300).optional().or(z.literal("")),
  fileName: optionalText(200),
  durationSec: z.coerce.number().positive().optional().or(z.literal("")),
  requiredPercent: z.coerce.number().int().min(1).max(100),
  lockCourses: z.boolean(),
  appliesTo: z.enum(["NEW", "ALL"]),
});
export type WelcomeVideoConfigInput = z.infer<typeof welcomeVideoConfigSchema>;
export const KEEP_WELCOME_FILE = "__keep__";

export const WELCOME_VIDEO_UPLOAD = { maxBytes: 1024 * 1024 * 1024, mimes: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } as Record<string, string> };
const WELCOME_KEY_PREFIX = "onboarding/welcome/";

export function getWelcomeVideoConfig(db: PrismaClient): Promise<WelcomeVideoConfig> {
  return getSetting(db, WELCOME_VIDEO_SETTING);
}

/** Admin (course.manage) edits the requirement. Replacing the video starts a new progress key so nobody keeps old credit. */
export async function updateWelcomeVideoConfig(db: PrismaClient, actor: Actor, raw: WelcomeVideoConfigInput): Promise<WelcomeVideoConfig> {
  authorize(actor, "course.manage");
  const input = welcomeVideoConfigSchema.parse(raw);
  const current = await getWelcomeVideoConfig(db);

  let storageKey: string | null = null;
  let fileName: string | null = null;
  if (input.storageKey === KEEP_WELCOME_FILE) {
    storageKey = current.storageKey;
    fileName = current.fileName;
  } else if (input.storageKey) {
    if (!input.storageKey.startsWith(WELCOME_KEY_PREFIX)) throw new ForbiddenError("Storage key is not a welcome-video upload");
    if (!(await getStorage().exists(input.storageKey))) throw new Error("The video file was not uploaded. Try again.");
    storageKey = input.storageKey;
    fileName = input.fileName || null;
  }
  const videoUrl = storageKey ? null : input.videoUrl || null;
  if (input.enabled && !storageKey && !videoUrl) throw new Error("Upload a video or enter a video URL before enabling the requirement.");

  const sourceChanged = storageKey !== current.storageKey || videoUrl !== current.videoUrl;
  const next: WelcomeVideoConfig = {
    enabled: input.enabled,
    title: input.title,
    instructions: input.instructions || "",
    videoUrl,
    storageKey,
    fileName,
    durationSec: input.durationSec === "" || input.durationSec === undefined ? (sourceChanged ? null : current.durationSec) : input.durationSec,
    requiredPercent: input.requiredPercent,
    lockCourses: input.lockCourses,
    appliesTo: input.appliesTo,
    effectiveFrom: current.effectiveFrom ?? (input.enabled ? new Date().toISOString() : null),
    videoKey: sourceChanged ? `v_${randomBytes(6).toString("hex")}` : current.videoKey,
  };
  await db.$transaction(async (tx) => {
    await settingRepository.upsert(tx, WELCOME_VIDEO_SETTING, next as never, actor.userId === "system" ? null : actor.userId);
    await audit(tx, { actor, action: "ONBOARDING_SETTINGS_CHANGED", entityType: "Setting", entityId: WELCOME_VIDEO_SETTING, previousValue: { enabled: current.enabled, requiredPercent: current.requiredPercent, lockCourses: current.lockCourses, appliesTo: current.appliesTo, videoKey: current.videoKey }, newValue: { enabled: next.enabled, requiredPercent: next.requiredPercent, lockCourses: next.lockCourses, appliesTo: next.appliesTo, videoKey: next.videoKey, source: storageKey ? "upload" : videoUrl ? "url" : "none" } });
  });
  return next;
}

export async function createWelcomeVideoUploadUrl(db: PrismaClient, actor: Actor, input: { contentType: string; sizeBytes: number }) {
  authorize(actor, "course.manage");
  rateLimit(`welcome-upload:${actor.userId}`, 20, 60 * 60_000);
  const ext = WELCOME_VIDEO_UPLOAD.mimes[input.contentType];
  if (!ext) throw new Error(`Unsupported video type: ${input.contentType}. Use MP4, WebM, or MOV.`);
  if (input.sizeBytes > WELCOME_VIDEO_UPLOAD.maxBytes) throw new Error("The video is too large. Maximum is 1 GB.");
  const key = newStorageKey(WELCOME_KEY_PREFIX.slice(0, -1), ext);
  return { key, ...(await getStorage().createUploadUrl(key, input.contentType)) };
}

/** Signed URL for the uploaded welcome video. Any signed-in user may watch it; there is nothing private in it. */
export async function welcomeVideoFileUrl(db: PrismaClient, actor: Actor): Promise<string> {
  void actor;
  const cfg = await getWelcomeVideoConfig(db);
  if (!cfg.storageKey) throw new NotFoundError();
  return getStorage().createDownloadUrl(cfg.storageKey, 60 * 60);
}

// ---------------------------------------------------------------------------
// Checklist and gating
// ---------------------------------------------------------------------------

export type OnboardingStep = { key: "email" | "profile" | "video" | "courses"; label: string; done: boolean; href: string; detail: string; required: boolean };
export type OnboardingView = {
  /** False for staff and clients, and for talent the requirement does not apply to. */
  applies: boolean;
  steps: OnboardingStep[];
  completed: number;
  total: number;
  done: boolean;
  coursesLocked: boolean;
  lockReason: string | null;
  status: OnboardingStatus;
  video: { required: boolean; title: string; percent: number; requiredPercent: number; completedAt: Date | null; lastPositionSec: number };
};
export type OnboardingStatus = "EMAIL_NOT_VERIFIED" | "PROFILE_INCOMPLETE" | "WELCOME_VIDEO_PENDING" | "ONBOARDING_COMPLETED";

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  EMAIL_NOT_VERIFIED: "Email not verified",
  PROFILE_INCOMPLETE: "Profile incomplete",
  WELCOME_VIDEO_PENDING: "Welcome video pending",
  ONBOARDING_COMPLETED: "Onboarding completed",
};

function videoRequiredFor(cfg: WelcomeVideoConfig, userCreatedAt: Date): boolean {
  if (!cfg.enabled) return false;
  if (cfg.appliesTo === "ALL") return true;
  return !!cfg.effectiveFrom && userCreatedAt.getTime() >= new Date(cfg.effectiveFrom).getTime();
}

function profileComplete(p: { status: string; submittedAt: Date | null; profileCompletion: number } | null | undefined, livePercent?: number): boolean {
  if (!p) return false;
  if (p.submittedAt || p.status !== "DRAFT") return true;
  return (livePercent ?? p.profileCompletion) >= PROFILE_COMPLETE_PERCENT;
}

export function statusOf(p: { emailVerified: boolean; profileDone: boolean; videoRequired: boolean; videoDone: boolean }): OnboardingStatus {
  if (!p.emailVerified) return "EMAIL_NOT_VERIFIED";
  if (!p.profileDone) return "PROFILE_INCOMPLETE";
  if (p.videoRequired && !p.videoDone) return "WELCOME_VIDEO_PENDING";
  return "ONBOARDING_COMPLETED";
}

/** The talent dashboard checklist. `liveProfilePercent` lets the caller pass computeCompletion() instead of the stored column. */
export async function onboardingFor(db: PrismaClient, actor: Actor, opts: { liveProfilePercent?: number } = {}): Promise<OnboardingView> {
  const cfg = await getWelcomeVideoConfig(db);
  const empty: OnboardingView = { applies: false, steps: [], completed: 0, total: 0, done: true, coursesLocked: false, lockReason: null, status: "ONBOARDING_COMPLETED", video: { required: false, title: cfg.title, percent: 0, requiredPercent: cfg.requiredPercent, completedAt: null, lastPositionSec: 0 } };
  if (actor.role !== "AGENT") return empty;
  const u = await onboardingRepository.userBasics(db, actor.userId);
  if (!u) return empty;
  const required = videoRequiredFor(cfg, u.createdAt);
  const progress = required ? await onboardingRepository.progress(db, u.id, cfg.videoKey) : null;
  const emailVerified = !!u.emailVerifiedAt;
  const profileDone = profileComplete(u.agentProfile, opts.liveProfilePercent);
  const videoDone = !!progress?.completedAt;
  const steps: OnboardingStep[] = [
    { key: "email", label: "Verify your email", done: emailVerified, href: "/verify-email", detail: emailVerified ? "Verified" : "Open the link we emailed you", required: true },
    { key: "profile", label: "Complete your basic profile", done: profileDone, href: "/profile", detail: profileDone ? "Done" : `Reach ${PROFILE_COMPLETE_PERCENT}% or submit it for review`, required: true },
  ];
  if (required) steps.push({ key: "video", label: `Watch: ${cfg.title}`, done: videoDone, href: "/onboarding/welcome-video", detail: videoDone ? "Completed" : progress ? `${progress.percent}% watched · ${cfg.requiredPercent}% required` : `About ${cfg.durationSec ? Math.max(1, Math.round(cfg.durationSec / 60)) + " min" : "a few minutes"} · ${cfg.requiredPercent}% required`, required: true });
  const coursesLocked = required && cfg.lockCourses && !videoDone;
  steps.push({ key: "courses", label: "Access the Academy courses", done: emailVerified && profileDone && !coursesLocked, href: "/courses", detail: coursesLocked ? "Unlocks after the welcome video" : "Open", required: false });
  const requiredSteps = steps.filter((s) => s.required);
  const completed = requiredSteps.filter((s) => s.done).length;
  return {
    applies: true,
    steps,
    completed,
    total: requiredSteps.length,
    done: completed === requiredSteps.length,
    coursesLocked,
    lockReason: coursesLocked ? `Watch "${cfg.title}" to unlock the courses.` : null,
    status: statusOf({ emailVerified, profileDone, videoRequired: required, videoDone }),
    video: { required, title: cfg.title, percent: progress?.percent ?? 0, requiredPercent: cfg.requiredPercent, completedAt: progress?.completedAt ?? null, lastPositionSec: progress?.lastPositionSec ?? 0 },
  };
}

/** Used by the Academy: are this talent's courses locked behind the welcome video? */
export async function coursesLockedFor(db: PrismaClient, actor: Actor): Promise<{ locked: boolean; reason: string | null }> {
  if (actor.role !== "AGENT") return { locked: false, reason: null };
  const cfg = await getWelcomeVideoConfig(db);
  if (!cfg.enabled || !cfg.lockCourses) return { locked: false, reason: null };
  const u = await onboardingRepository.userBasics(db, actor.userId);
  if (!u || !videoRequiredFor(cfg, u.createdAt)) return { locked: false, reason: null };
  const progress = await onboardingRepository.progress(db, u.id, cfg.videoKey);
  if (progress?.completedAt) return { locked: false, reason: null };
  return { locked: true, reason: `Watch "${cfg.title}" on your dashboard to unlock the Academy.` };
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

export const progressReportSchema = z.object({
  positionSec: z.coerce.number().min(0),
  /** Seconds actually played since the previous report (the client sums timeupdate deltas, ignoring seeks). */
  watchedDeltaSec: z.coerce.number().min(0).max(60).optional(),
  /** Same field as the lesson players send (shared tracker, phase 9). One of the two is required. */
  playedDeltaSec: z.coerce.number().min(0).max(60).optional(),
  durationSec: z.coerce.number().positive().optional(),
  /** Wall-clock ms since the previous report; caps the credited delta so a tampered client cannot fast-forward. */
  elapsedMs: z.coerce.number().min(0).optional(),
  playbackRate: z.coerce.number().min(0.25).max(2).optional(),
});
export type ProgressReport = z.infer<typeof progressReportSchema>;

export async function recordVideoProgress(db: PrismaClient, actor: Actor, raw: ProgressReport) {
  if (actor.role !== "AGENT") throw new ForbiddenError("Only talent watch the welcome video");
  const input = progressReportSchema.parse(raw);
  const cfg = await getWelcomeVideoConfig(db);
  if (!cfg.enabled) throw new NotFoundError();
  const existing = await onboardingRepository.progress(db, actor.userId, cfg.videoKey);
  const durationSec = input.durationSec ?? existing?.durationSec ?? cfg.durationSec ?? null;
  // Same crediting rule as lesson audio and video (media-credit.ts): wall-clock capped, never more than 60 s per report.
  const delta = input.playedDeltaSec ?? input.watchedDeltaSec ?? 0;
  const { seconds: watchedSeconds, percent, reached } = creditPlayback({ existingSeconds: existing?.watchedSeconds ?? 0, deltaSec: delta, elapsedMs: input.elapsedMs, playbackRate: input.playbackRate, durationSec, requiredPercent: cfg.requiredPercent });
  const nowComplete = !existing?.completedAt && reached;
  const row = await db.$transaction(async (tx) => {
    const r = await onboardingRepository.upsertProgress(tx, actor.userId, cfg.videoKey, {
      watchedSeconds,
      lastPositionSec: Math.min(input.positionSec, durationSec ?? input.positionSec),
      durationSec,
      percent,
      completedAt: nowComplete ? new Date() : undefined,
    });
    if (nowComplete) {
      await audit(tx, { actor, action: "ONBOARDING_VIDEO_COMPLETED", entityType: "OnboardingVideoProgress", entityId: r.id, newValue: { videoKey: cfg.videoKey, percent, watchedSeconds: Math.round(watchedSeconds), durationSec, requiredPercent: cfg.requiredPercent } });
      logger.info({ userId: actor.userId, percent, requiredPercent: cfg.requiredPercent }, "onboarding: welcome video completed");
    }
    return r;
  });
  // Includes the shared player-state fields so the lesson tracker (useMediaProgress) can drive this endpoint too.
  return { percent: row.percent, completed: !!row.completedAt, completedAt: row.completedAt, lastPositionSec: row.lastPositionSec, watchedSeconds: row.watchedSeconds, requiredPercent: cfg.requiredPercent, durationSec, audioCompletedAt: row.completedAt, status: row.completedAt ? "COMPLETED" : "IN_PROGRESS", quizUnlocked: false };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type OnboardingAdminRow = { userId: string; email: string; displayName: string | null; agentProfileId: string | null; createdAt: Date; emailVerified: boolean; profileDone: boolean; profileStatus: string | null; videoRequired: boolean; videoPercent: number; videoCompletedAt: Date | null; lastWatchedAt: Date | null; status: OnboardingStatus; statusLabel: string };

export async function onboardingAdminList(db: PrismaClient, actor: Actor, q?: string): Promise<{ config: WelcomeVideoConfig; rows: OnboardingAdminRow[]; summary: Record<OnboardingStatus, number> & { completedVideo: number } }> {
  authorize(actor, "course.manage");
  const cfg = await getWelcomeVideoConfig(db);
  const users = await onboardingRepository.listAgents(db, q?.trim() || undefined, cfg.videoKey);
  const summary: Record<OnboardingStatus, number> & { completedVideo: number } = { EMAIL_NOT_VERIFIED: 0, PROFILE_INCOMPLETE: 0, WELCOME_VIDEO_PENDING: 0, ONBOARDING_COMPLETED: 0, completedVideo: 0 };
  const rows = users.map((u) => {
    const p = u.onboardingVideoProgress[0];
    const videoRequired = videoRequiredFor(cfg, u.createdAt);
    const row: OnboardingAdminRow = {
      userId: u.id,
      email: u.email,
      displayName: u.agentProfile?.displayName ?? null,
      agentProfileId: u.agentProfile?.id ?? null,
      createdAt: u.createdAt,
      emailVerified: !!u.emailVerifiedAt,
      profileDone: profileComplete(u.agentProfile),
      profileStatus: u.agentProfile?.status ?? null,
      videoRequired,
      videoPercent: p?.percent ?? 0,
      videoCompletedAt: p?.completedAt ?? null,
      lastWatchedAt: p?.updatedAt ?? null,
      status: "ONBOARDING_COMPLETED",
      statusLabel: "",
    };
    row.status = statusOf({ emailVerified: row.emailVerified, profileDone: row.profileDone, videoRequired, videoDone: !!row.videoCompletedAt });
    row.statusLabel = ONBOARDING_STATUS_LABELS[row.status];
    summary[row.status]++;
    if (row.videoCompletedAt) summary.completedVideo++;
    return row;
  });
  return { config: cfg, rows, summary };
}
