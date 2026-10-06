import type { Db, Prisma, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { NotFoundError } from "@/server/policies/authorize";
import { versionRepository } from "@/server/repositories/version.repository";
import { academyRepository, type LessonWrite } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { loadEditableCourse } from "./academy.service";
import { recalculateAllForCourse } from "./progress.service";

/**
 * Lesson version history (Course Builder phase 8). Every *significant* change to a published-or-not lesson, or to its
 * question set, freezes the previous state as a LessonVersion (who, when, what changed) and bumps `lesson.version`.
 * Attempts and lesson progress record the version they happened on, so results and completions stay attributable
 * after edits. Cosmetic changes (description, explanations, answer-reveal flags) do not create a version.
 */
export const SIGNIFICANT_FIELDS: Array<[keyof LessonWrite, string]> = [
  ["contentType", "lesson type"],
  ["title", "title"],
  ["body", "content"],
  ["url", "link"],
  ["storageKey", "file"],
  ["isRequired", "required flag"],
  ["status", "draft / published"],
  ["requiredPercent", "required listening or watching"],
  ["passingScore", "passing score"],
  ["maxAttempts", "attempt limit"],
  ["timeLimitMin", "time limit"],
  ["randomizeCount", "random draw"],
  ["shuffleAnswers", "answer shuffle"],
  ["scorePolicy", "score policy"],
  ["reviewMode", "review mode"],
  ["submissionType", "submission type"],
  ["dueAt", "due date"],
  ["points", "points"],
];

const norm = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).getTime() : v ?? null);

/** Labels of the significant fields that differ between two lesson states. */
export function changedFields(before: Partial<Record<keyof LessonWrite, unknown>>, after: Partial<Record<keyof LessonWrite, unknown>>): string[] {
  return SIGNIFICANT_FIELDS.filter(([k]) => norm(before[k]) !== norm(after[k])).map(([, label]) => label);
}

export type LessonSnapshot = {
  version: number;
  fields: Record<string, unknown>;
  questions: Array<{ id: string; version: number; type: string; prompt: string; points: number; state: string; keywords: string[]; choices: Array<{ id: string; text: string; isCorrect: boolean }> }>;
};

async function snapshotOf(db: Db, lessonId: string): Promise<LessonSnapshot> {
  const l = await versionRepository.lessonForSnapshot(db, lessonId);
  const fields: Record<string, unknown> = {};
  for (const [k] of SIGNIFICANT_FIELDS) fields[k] = (l as unknown as Record<string, unknown>)[k];
  for (const k of ["description", "fileName", "contentMime", "sizeBytes", "durationSec", "showCorrectAnswers", "showExplanations", "retakeWaitMinutes"] as const) fields[k] = l[k];
  return { version: l.version, fields, questions: l.questions.map((q) => ({ id: q.id, version: q.version, type: q.type, prompt: q.prompt, points: q.points, state: q.state, keywords: q.keywords, choices: q.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })) })) };
}

/**
 * Freeze the lesson's current state as its current version number, then move the lesson to the next version.
 * Call inside the transaction that applies the change, *before* writing it. Returns the new version number.
 */
export async function recordLessonVersion(db: Db, lessonId: string, actor: Actor, reason: string): Promise<number> {
  const snap = await snapshotOf(db, lessonId);
  await versionRepository.create(db, { lessonId, version: snap.version, snapshot: snap as unknown as Prisma.InputJsonValue, changedById: actor.userId, reason });
  const { version } = await versionRepository.bumpVersion(db, lessonId);
  return version;
}

export type VersionRow = {
  version: number;
  changedAt: Date;
  changedBy: string | null;
  reason: string | null;
  changes: Array<{ field: string; from: string; to: string }>;
  questionCount: number;
  attempts: number;
  completions: number;
  snapshot: LessonSnapshot;
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "boolean") return v ? "on" : "off";
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

function diff(a: LessonSnapshot, b: LessonSnapshot): VersionRow["changes"] {
  const out: VersionRow["changes"] = [];
  for (const [k, label] of SIGNIFICANT_FIELDS) if (norm(a.fields[k]) !== norm(b.fields[k])) out.push({ field: label, from: show(a.fields[k]), to: show(b.fields[k]) });
  const aq = new Map(a.questions.map((q) => [q.id, q]));
  const bq = new Map(b.questions.map((q) => [q.id, q]));
  for (const q of b.questions) if (!aq.has(q.id)) out.push({ field: "question added", from: "—", to: show(q.prompt) });
  for (const q of a.questions) {
    const n = bq.get(q.id);
    if (!n) out.push({ field: "question removed", from: show(q.prompt), to: "—" });
    else if (n.version !== q.version || n.state !== q.state || n.points !== q.points) out.push({ field: n.version !== q.version ? "question changed" : n.state !== q.state ? "question state" : "question points", from: n.version !== q.version ? show(q.prompt) : n.state !== q.state ? q.state.toLowerCase() : String(q.points), to: n.version !== q.version ? show(n.prompt) : n.state !== q.state ? n.state.toLowerCase() : String(n.points) });
  }
  return out;
}

/** The lesson's history: every frozen version with who changed it, when, why, what changed, and what happened on it. */
export async function lessonHistory(db: PrismaClient, actor: Actor, courseId: string, lessonId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  const [rows, usage, current] = await Promise.all([versionRepository.listForLesson(db, lessonId), versionRepository.usage(db, lessonId), snapshotOf(db, lessonId)]);
  const users = new Map((await versionRepository.usersByIds(db, [...new Set(rows.map((r) => r.changedById).filter((x): x is string => !!x))])).map((u) => [u.id, u.email.split("@")[0]]));
  const snaps = rows.map((r) => r.snapshot as unknown as LessonSnapshot);
  const versions: VersionRow[] = rows.map((r, i) => {
    const next = snaps[i + 1] ?? current;
    return { version: r.version, changedAt: r.changedAt, changedBy: r.changedById ? users.get(r.changedById) ?? r.changedById : null, reason: r.reason, changes: diff(snaps[i], next), questionCount: snaps[i].questions.length, attempts: usage.attempts.get(r.version) ?? 0, completions: usage.completions.get(r.version) ?? 0, snapshot: snaps[i] };
  }).reverse();
  return { current: { version: current.version, attempts: usage.attempts.get(current.version) ?? 0, completions: usage.completions.get(current.version) ?? 0, questionCount: current.questions.length }, versions };
}

/**
 * Put a previous version's content and settings back (questions are not restored; attempts keep their snapshots).
 * The restore itself is recorded as a new version, so nothing is lost.
 */
export async function restoreLessonVersion(db: PrismaClient, actor: Actor, courseId: string, lessonId: string, version: number) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  const row = await versionRepository.find(db, lessonId, version);
  if (!row) throw new NotFoundError();
  const snap = row.snapshot as unknown as LessonSnapshot;
  const f = snap.fields;
  const write: LessonWrite = {
    title: String(f.title ?? l.title),
    contentType: (f.contentType as LessonWrite["contentType"]) ?? l.contentType,
    description: (f.description as string | null) ?? null,
    body: (f.body as string | null) ?? null,
    url: (f.url as string | null) ?? null,
    storageKey: (f.storageKey as string | null) ?? null,
    fileName: (f.fileName as string | null) ?? null,
    contentMime: (f.contentMime as string | null) ?? null,
    sizeBytes: (f.sizeBytes as number | null) ?? null,
    durationSec: (f.durationSec as number | null) ?? null,
    isRequired: Boolean(f.isRequired),
    status: (f.status as LessonWrite["status"]) ?? l.status,
    requiredPercent: (f.requiredPercent as number | null) ?? null,
    passingScore: (f.passingScore as number | null) ?? null,
    maxAttempts: (f.maxAttempts as number | null) ?? null,
    timeLimitMin: (f.timeLimitMin as number | null) ?? null,
    randomizeCount: (f.randomizeCount as number | null) ?? null,
    shuffleAnswers: Boolean(f.shuffleAnswers),
    showCorrectAnswers: f.showCorrectAnswers === undefined ? true : Boolean(f.showCorrectAnswers),
    showExplanations: f.showExplanations === undefined ? true : Boolean(f.showExplanations),
    retakeWaitMinutes: (f.retakeWaitMinutes as number | null) ?? null,
    scorePolicy: (f.scorePolicy as LessonWrite["scorePolicy"]) ?? "HIGHEST",
    reviewMode: (f.reviewMode as LessonWrite["reviewMode"]) ?? "AUTO",
    dueAt: f.dueAt ? new Date(f.dueAt as string) : null,
    points: (f.points as number | null) ?? null,
    submissionType: (f.submissionType as LessonWrite["submissionType"]) ?? null,
  };
  return db.$transaction(async (tx) => {
    const newVersion = await recordLessonVersion(tx, lessonId, actor, `Restored version ${version}`);
    await academyRepository.updateLesson(tx, lessonId, l.moduleId, write);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseLesson", entityId: lessonId, previousValue: { version: newVersion - 1 }, newValue: { courseId: c.id, op: "restore", restoredVersion: version, version: newVersion } });
    await recalculateAllForCourse(tx, c.id);
    return newVersion;
  });
}
