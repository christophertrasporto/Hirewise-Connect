import type { MediaStatus, RecordingKind } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const mediaRepository = {
  async createVideo(db: Db, d: { agentProfileId: string; storageKey: string; durationSec: number | null }) {
    // A new upload supersedes any earlier draft/submitted intro; approved ones are retired on approval of the new one (Phase 1B).
    await db.video.updateMany({ where: { agentProfileId: d.agentProfileId, status: { in: ["DRAFT", "UPLOADED", "SUBMITTED", "REVISION_REQUIRED", "REJECTED"] } }, data: { status: "RETIRED", isCurrent: false } });
    return db.video.create({ data: { agentProfileId: d.agentProfileId, kind: "INTRODUCTION", storageKey: d.storageKey, durationSec: d.durationSec ?? undefined, status: "SUBMITTED", submittedAt: new Date(), isCurrent: true } });
  },

  createRecording(db: Db, d: { agentProfileId: string; kind: RecordingKind; title: string; storageKey: string; durationSec: number | null }) {
    return db.recording.create({ data: { agentProfileId: d.agentProfileId, kind: d.kind, title: d.title, storageKey: d.storageKey, durationSec: d.durationSec ?? undefined, status: "SUBMITTED", submittedAt: new Date() } });
  },

  findVideo(db: Db, id: string) {
    return db.video.findUnique({ where: { id }, select: { id: true, agentProfileId: true, storageKey: true, status: true } });
  },

  findRecording(db: Db, id: string) {
    return db.recording.findUnique({ where: { id }, select: { id: true, agentProfileId: true, storageKey: true, status: true } });
  },

  setVideoStatus(db: Db, id: string, status: MediaStatus, review: { reviewedById: string; reviewFeedback: string | null }) {
    return db.video.update({ where: { id }, data: { status, reviewedById: review.reviewedById, reviewedAt: new Date(), reviewFeedback: review.reviewFeedback } });
  },

  setRecordingStatus(db: Db, id: string, status: MediaStatus, review: { reviewedById: string; reviewFeedback: string | null }) {
    return db.recording.update({ where: { id }, data: { status, reviewedById: review.reviewedById, reviewedAt: new Date(), reviewFeedback: review.reviewFeedback } });
  },

  countPendingReview(db: Db) {
    return Promise.all([
      db.video.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      db.recording.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    ]);
  },
};
