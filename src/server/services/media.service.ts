import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { mediaRepository } from "@/server/repositories/media.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/audit/audit";
import { recomputeVerification } from "./verification.service";
import { publishEvent } from "@/server/events/outbox";
import { setResume } from "./agent.service";

/** Upload categories with MIME allowlist and size caps (Section 12, security baseline). */
export const UPLOAD_RULES = {
  RESUME: { maxBytes: 10 * 1024 * 1024, mimes: { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" } },
  PHOTO: { maxBytes: 5 * 1024 * 1024, mimes: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } },
  VIDEO: { maxBytes: 200 * 1024 * 1024, mimes: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } },
  RECORDING: { maxBytes: 25 * 1024 * 1024, mimes: { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm", "audio/ogg": "ogg" } },
} as const;

export type UploadKind = keyof typeof UPLOAD_RULES;

export const uploadRequestSchema = z.object({
  kind: z.enum(["RESUME", "PHOTO", "VIDEO", "RECORDING"]),
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
});

export class UploadRejectedError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

function ownProfileId(actor: Actor): string {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only agents upload profile media");
  return actor.agentProfileId;
}

/** Storage keys embed the owning profile id so confirm() can verify ownership without a lookup table. */
function keyPrefix(agentProfileId: string, kind: UploadKind) {
  return `agents/${agentProfileId}/${kind.toLowerCase()}`;
}

/** Step 1: the browser asks for a presigned PUT. Nothing is recorded until confirm. */
export async function createUploadUrl(actor: Actor, input: z.infer<typeof uploadRequestSchema>) {
  const profileId = ownProfileId(actor);
  rateLimit(`upload:${actor.userId}`, 30, 60 * 60_000);
  const rule = UPLOAD_RULES[input.kind];
  const ext = (rule.mimes as Record<string, string>)[input.contentType];
  if (!ext) throw new UploadRejectedError(`Unsupported file type for ${input.kind.toLowerCase()}: ${input.contentType}`);
  if (input.sizeBytes > rule.maxBytes) throw new UploadRejectedError(`File is too large. Maximum is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
  const key = newStorageKey(keyPrefix(profileId, input.kind), ext);
  const upload = await getStorage().createUploadUrl(key, input.contentType);
  return { key, ...upload };
}

async function assertOwnedUploadedKey(actor: Actor, kind: UploadKind, key: string): Promise<string> {
  const profileId = ownProfileId(actor);
  if (!key.startsWith(`${keyPrefix(profileId, kind)}/`)) throw new ForbiddenError("Storage key does not belong to this profile");
  if (!(await getStorage().exists(key))) throw new UploadRejectedError("The file was not uploaded. Try again.");
  return profileId;
}

/** Step 2 variants: record what was uploaded. */
export async function confirmResumeUpload(db: PrismaClient, actor: Actor, key: string) {
  await assertOwnedUploadedKey(actor, "RESUME", key);
  return setResume(db, actor, key);
}

export async function confirmPhotoUpload(db: PrismaClient, actor: Actor, key: string) {
  const profileId = await assertOwnedUploadedKey(actor, "PHOTO", key);
  await agentRepository.setPhotoKey(db, profileId, key);
}

export async function confirmVideoUpload(db: PrismaClient, actor: Actor, key: string, durationSec: number | null) {
  const profileId = await assertOwnedUploadedKey(actor, "VIDEO", key);
  await db.$transaction(async (tx) => {
    const v = await mediaRepository.createVideo(tx, { agentProfileId: profileId, storageKey: key, durationSec });
    await audit(tx, { actor, action: "VIDEO_SUBMITTED", entityType: "Video", entityId: v.id, newValue: { status: "SUBMITTED" } });
  });
}

export const recordingKindSchema = z.enum(["INTRODUCTION", "COLD_CALL", "CUSTOMER_SERVICE", "SALES", "CUSTOM_CAMPAIGN"]);

export async function confirmRecordingUpload(db: PrismaClient, actor: Actor, key: string, kind: z.infer<typeof recordingKindSchema>, title: string, durationSec: number | null) {
  const profileId = await assertOwnedUploadedKey(actor, "RECORDING", key);
  await db.$transaction(async (tx) => {
    const r = await mediaRepository.createRecording(tx, { agentProfileId: profileId, kind, title: title.trim().slice(0, 120) || kind, storageKey: key, durationSec });
    await audit(tx, { actor, action: "RECORDING_SUBMITTED", entityType: "Recording", entityId: r.id, newValue: { status: "SUBMITTED", kind } });
  });
}

/**
 * Signed download URL after an authorization check (INV-P6).
 * Agents: own media in any status. Staff: with media.review or agent.read_public.
 * Clients: APPROVED media only (Phase 1B search wires this).
 */
export async function mediaDownloadUrl(db: PrismaClient, actor: Actor, target: { type: "VIDEO" | "RECORDING" | "RESUME"; id: string }): Promise<string> {
  if (target.type === "RESUME") {
    const p = await agentRepository.findByIdForStaff(db, target.id);
    if (!p?.privateContact?.resumeKey) throw new NotFoundError();
    const own = actor.role === "AGENT" && actor.agentProfileId === p.id;
    if (!own && !actor.permissions.has("agent.read_private_contact")) throw new ForbiddenError("Résumé requires agent.read_private_contact");
    return getStorage().createDownloadUrl(p.privateContact.resumeKey);
  }
  const m = target.type === "VIDEO" ? await mediaRepository.findVideo(db, target.id) : await mediaRepository.findRecording(db, target.id);
  if (!m) throw new NotFoundError();
  const own = actor.role === "AGENT" && actor.agentProfileId === m.agentProfileId;
  const staff = actor.permissions.has("media.review") || actor.permissions.has("agent.read_public");
  const clientOk = actor.role === "CLIENT" && m.status === "APPROVED";
  if (!own && !staff && !clientOk) throw new NotFoundError();
  return getStorage().createDownloadUrl(m.storageKey);
}

// ---------------------------------------------------------------------------
// Review (Section 5.3): SUBMITTED | UNDER_REVIEW → APPROVED | REJECTED | REVISION_REQUIRED
// ---------------------------------------------------------------------------

export const mediaDecisionSchema = z.object({
  type: z.enum(["VIDEO", "RECORDING"]),
  id: z.string().min(1),
  decision: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "REVISION_REQUIRED"]),
  feedback: z.string().trim().max(2000).optional(),
});

export async function listMediaReviewQueue(db: PrismaClient, actor: Actor) {
  authorize(actor, "media.review");
  const [videos, recordings] = await mediaRepository.reviewQueue(db);
  return {
    videos: videos.map((v) => ({ id: v.id, status: v.status, durationSec: v.durationSec, submittedAt: v.submittedAt, agent: v.agentProfile })),
    recordings: recordings.map((r) => ({ id: r.id, status: r.status, kind: r.kind, title: r.title, durationSec: r.durationSec, submittedAt: r.submittedAt, agent: r.agentProfile })),
  };
}

export async function reviewMedia(db: PrismaClient, actor: Actor, input: z.infer<typeof mediaDecisionSchema>) {
  authorize(actor, "media.review");
  const feedback = input.feedback?.trim() || null;
  if ((input.decision === "REJECTED" || input.decision === "REVISION_REQUIRED") && !feedback) throw new Error("Feedback is required when rejecting or requesting a revision.");
  const m = input.type === "VIDEO" ? await mediaRepository.findVideo(db, input.id) : await mediaRepository.findRecording(db, input.id);
  if (!m) throw new NotFoundError();
  const allowedFrom = ["SUBMITTED", "UNDER_REVIEW"];
  if (!allowedFrom.includes(m.status)) throw new Error(`Cannot review media in status ${m.status}`);
  await db.$transaction(async (tx) => {
    if (input.type === "VIDEO") await mediaRepository.setVideoStatus(tx, m.id, input.decision, { reviewedById: actor.userId, reviewFeedback: feedback });
    else await mediaRepository.setRecordingStatus(tx, m.id, input.decision, { reviewedById: actor.userId, reviewFeedback: feedback });
    const action = input.type === "VIDEO" ? (input.decision === "APPROVED" ? "VIDEO_APPROVED" : "VIDEO_REVIEWED") : input.decision === "APPROVED" ? "RECORDING_APPROVED" : "RECORDING_REVIEWED";
    await audit(tx, { actor, action, entityType: input.type === "VIDEO" ? "Video" : "Recording", entityId: m.id, previousValue: { status: m.status }, newValue: { status: input.decision }, reason: feedback ?? undefined });
    if (input.decision === "APPROVED") await recomputeVerification(tx, m.agentProfileId, actor);
    if (input.decision !== "UNDER_REVIEW") {
      await publishEvent(tx, "MEDIA_REVIEWED", { type: input.type, mediaId: m.id, agentProfileId: m.agentProfileId, userId: m.agentProfile.userId, email: m.agentProfile.user.email, outcome: input.decision, feedback, title: input.type === "RECORDING" && "title" in m ? String(m.title) : "Video introduction" });
    }
  });
}
