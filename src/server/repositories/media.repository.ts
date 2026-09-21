import type { MediaStatus, RecordingKind } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const mediaRepository = {
  async createVideo(db: Db, d: { agentProfileId: string; storageKey: string; durationSec: number | null }) {
    // A new upload supersedes any earlier unapproved intro. An approved one is retired when the new one is approved.
    await db.video.updateMany({ where: { agentProfileId: d.agentProfileId, status: { in: ["DRAFT", "UPLOADED", "SUBMITTED", "REVISION_REQUIRED", "REJECTED"] } }, data: { status: "RETIRED", isCurrent: false } });
    return db.video.create({ data: { agentProfileId: d.agentProfileId, kind: "INTRODUCTION", storageKey: d.storageKey, durationSec: d.durationSec ?? undefined, status: "SUBMITTED", submittedAt: new Date(), isCurrent: true } });
  },

  createRecording(db: Db, d: { agentProfileId: string; kind: RecordingKind; title: string; storageKey: string; durationSec: number | null }) {
    return db.recording.create({ data: { agentProfileId: d.agentProfileId, kind: d.kind, title: d.title, storageKey: d.storageKey, durationSec: d.durationSec ?? undefined, status: "SUBMITTED", submittedAt: new Date() } });
  },

  findVideo(db: Db, id: string) {
    return db.video.findUnique({ where: { id }, select: { id: true, agentProfileId: true, storageKey: true, status: true, agentProfile: { select: { userId: true, displayName: true, user: { select: { email: true } } } } } });
  },

  findRecording(db: Db, id: string) {
    return db.recording.findUnique({ where: { id }, select: { id: true, agentProfileId: true, storageKey: true, status: true, title: true, agentProfile: { select: { userId: true, displayName: true, user: { select: { email: true } } } } } });
  },

  async setVideoStatus(db: Db, id: string, status: MediaStatus, review: { reviewedById: string; reviewFeedback: string | null }) {
    const v = await db.video.update({ where: { id }, data: { status, reviewedById: review.reviewedById, reviewedAt: new Date(), reviewFeedback: review.reviewFeedback, isCurrent: status === "APPROVED" ? true : undefined } });
    if (status === "APPROVED") {
      // One approved intro at a time: retire earlier approved videos.
      await db.video.updateMany({ where: { agentProfileId: v.agentProfileId, id: { not: id }, status: "APPROVED" }, data: { status: "RETIRED", isCurrent: false } });
    }
    return v;
  },

  setRecordingStatus(db: Db, id: string, status: MediaStatus, review: { reviewedById: string; reviewFeedback: string | null }) {
    return db.recording.update({ where: { id }, data: { status, reviewedById: review.reviewedById, reviewedAt: new Date(), reviewFeedback: review.reviewFeedback } });
  },

  /** Review queue: everything awaiting a decision, oldest first. */
  reviewQueue(db: Db, take = 100) {
    const where = { status: { in: ["SUBMITTED", "UNDER_REVIEW"] as MediaStatus[] } };
    const include = { agentProfile: { select: { id: true, displayName: true, primaryRole: true, status: true } } };
    return Promise.all([
      db.video.findMany({ where, include, orderBy: { submittedAt: "asc" }, take }),
      db.recording.findMany({ where, include, orderBy: { submittedAt: "asc" }, take }),
    ]);
  },

  countPendingReview(db: Db) {
    return Promise.all([
      db.video.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      db.recording.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    ]);
  },
};
