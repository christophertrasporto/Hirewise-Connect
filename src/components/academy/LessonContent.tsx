import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardCheck, ClipboardList, Download, ExternalLink, FileText, Headphones, Link2, ListChecks, Lock, Type, Video } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { fmtBytes, fmtDuration, LESSON_TYPE_META, type LessonContentType } from "@/components/academy/lesson-meta";
import { AudioPlayer } from "@/components/academy/AudioPlayer";

type OutlineLesson = { id: string; title: string; contentType: LessonContentType; durationSec: number | null };
type OutlineModule = { id: string; title: string; description: string | null; lessons: OutlineLesson[] };
type Lesson = OutlineLesson & { description?: string | null; body: string | null; url: string | null; hasFile: boolean; fileName: string | null; contentMime: string | null; sizeBytes: number | null; isRequired?: boolean; questionCount?: number; requiredPercent?: number | null };
type Module = Omit<OutlineModule, "lessons"> & { lessons: Lesson[] };
export type LessonProgressMap = Record<string, { status: string; completedAt: Date | null; mediaPercent: number; lastPositionSec?: number; mediaCompletedAt?: Date | null }>;

const ICONS: Record<LessonContentType, typeof Video> = { VIDEO: Video, AUDIO: Headphones, LINK: Link2, DOCUMENT: FileText, TEXT: Type, QUIZ: ListChecks, ASSIGNMENT: ClipboardList, ASSESSMENT: ClipboardCheck };
const QUESTION_TYPES: LessonContentType[] = ["QUIZ", "ASSESSMENT", "AUDIO"];
/** Audio lessons open their quiz from the player once the required share has been heard. */
const QUIZ_LINK_TYPES: LessonContentType[] = ["QUIZ", "ASSESSMENT"];

/** Uploaded lesson files are streamed through the app so access is re-checked on every play. */
export const lessonFileUrl = (lessonId: string) => `/api/academy/lessons/${lessonId}`;

/** Embeddable player URL for the common hosted-video services; anything else opens as a link. */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v") ?? (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
      return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === "player.vimeo.com") return url;
    if (host === "loom.com") {
      const m = u.pathname.match(/\/(?:share|embed)\/([a-z0-9]+)/i);
      return m ? `https://www.loom.com/embed/${m[1]}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Titles and types only: shown in the catalog and to enrolled learners whose payment is still pending. */
export function LessonOutline({ modules }: { modules: OutlineModule[] }) {
  return (
    <ol className="space-y-3">
      {modules.map((m, i) => (
        <li key={m.id}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {i + 1}</p>
          <p className="text-[15px] font-bold text-ink-800">{m.title}</p>
          <ul className="mt-1.5 space-y-1">
            {m.lessons.map((l) => {
              const I = ICONS[l.contentType];
              return <li key={l.id} className="flex items-center gap-2 text-[13.5px] text-ink-500"><I className="h-3.5 w-3.5 text-ink-300" /> {l.title}{l.durationSec ? <span className="text-ink-300">· {fmtDuration(l.durationSec)}</span> : null}</li>;
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function StatusChip({ status }: { status: string | undefined }) {
  if (!status || status === "NOT_STARTED") return null;
  const map: Record<string, { label: string; cls: string }> = {
    IN_PROGRESS: { label: "In progress", cls: "bg-ink-50 text-ink-600 ring-ink-200" },
    COMPLETED: { label: "Completed", cls: "bg-brand-50 text-brand-700 ring-brand-200" },
    FAILED: { label: "Not passed", cls: "bg-red-50 text-red-700 ring-red-200" },
    RETAKE_REQUIRED: { label: "Retake", cls: "bg-gold-50 text-gold-700 ring-gold-200" },
    PENDING_REVIEW: { label: "Awaiting review", cls: "bg-gold-50 text-gold-700 ring-gold-200" },
  };
  const m = map[status];
  if (!m) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

function LessonBody({ lesson, courseId, progress }: { lesson: Lesson; courseId?: string; progress?: LessonProgressMap[string] }) {
  const embed = lesson.contentType === "VIDEO" && lesson.url ? embedUrl(lesson.url) : null;
  const quizHref = courseId ? `/courses/${courseId}/quiz/${lesson.id}` : null;
  return (
    <div className="mt-3 space-y-3">
      {lesson.description && <p className="text-[13.5px] text-ink-500">{lesson.description}</p>}
      {lesson.contentType === "VIDEO" && lesson.hasFile && <video controls preload="metadata" className="w-full rounded-2xl bg-ink-900" src={lessonFileUrl(lesson.id)} />}
      {lesson.contentType === "VIDEO" && !lesson.hasFile && embed && <div className="aspect-video overflow-hidden rounded-2xl bg-ink-900"><iframe src={embed} title={lesson.title} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
      {lesson.contentType === "VIDEO" && !lesson.hasFile && !embed && lesson.url && <a href={lesson.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 hover:text-brand-700">Watch the video <ExternalLink className="h-4 w-4" /></a>}
      {lesson.contentType === "AUDIO" && lesson.hasFile && (
        <AudioPlayer lessonId={lesson.id} src={lessonFileUrl(lesson.id)} title={lesson.title} durationSec={lesson.durationSec} requiredPercent={lesson.requiredPercent ?? 90} questionCount={lesson.questionCount ?? 0} quizHref={quizHref} trackable={!!courseId} initial={{ percent: progress?.mediaPercent ?? 0, positionSec: progress?.lastPositionSec ?? 0, audioCompleted: !!progress?.mediaCompletedAt, status: progress?.status ?? "NOT_STARTED" }} />
      )}
      {lesson.contentType === "DOCUMENT" && lesson.hasFile && (
        <a href={lessonFileUrl(lesson.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-[14px] font-semibold text-ink-800 hover:border-brand-300 hover:text-brand-700">
          <Download className="h-4 w-4 text-brand-600" /> {lesson.fileName ?? "Open document"}{lesson.sizeBytes ? <span className="font-normal text-ink-400">· {fmtBytes(lesson.sizeBytes)}</span> : null}
        </a>
      )}
      {lesson.contentType === "LINK" && lesson.url && <a href={lesson.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-[14px] font-semibold text-brand-600 hover:text-brand-700">{lesson.url.replace(/^https?:\/\//, "")} <ExternalLink className="h-4 w-4 shrink-0" /></a>}
      {lesson.contentType === "TEXT" && lesson.body && <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-700">{renderMarkdown(lesson.body)}</div>}
      {lesson.contentType === "ASSIGNMENT" && lesson.body && <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-700">{renderMarkdown(lesson.body)}</div>}
      {lesson.contentType === "ASSIGNMENT" && <p className="text-[12.5px] text-ink-400">Assignment submissions arrive in a later phase.</p>}
      {(lesson.contentType === "QUIZ" || lesson.contentType === "ASSESSMENT") && lesson.body && <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-600">{lesson.body}</p>}
      {QUIZ_LINK_TYPES.includes(lesson.contentType) && quizHref && (
        <Link href={quizHref} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">
          {lesson.contentType === "ASSESSMENT" ? "Open the assessment" : "Open the quiz"} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      {lesson.contentType !== "TEXT" && lesson.contentType !== "ASSIGNMENT" && lesson.contentType !== "QUIZ" && lesson.contentType !== "ASSESSMENT" && lesson.body && <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-600">{lesson.body}</p>}
    </div>
  );
}

/** Full curriculum for an unlocked enrolment. `progress` adds per-lesson status chips; `courseId` enables quiz links. */
export function LessonContent({ modules, courseId, progress = {} }: { modules: Module[]; courseId?: string; progress?: LessonProgressMap }) {
  return (
    <ol className="space-y-6">
      {modules.map((m, i) => (
        <li key={m.id}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {i + 1}</p>
          <p className="text-[16px] font-bold text-ink-900">{m.title}</p>
          {m.description && <p className="mt-0.5 text-[13.5px] text-ink-500">{m.description}</p>}
          <ol className="mt-3 space-y-3">
            {m.lessons.map((l, j) => {
              const I = ICONS[l.contentType];
              const p = progress[l.id];
              const done = p?.status === "COMPLETED";
              return (
                <li key={l.id} id={`lesson-${l.id}`} className="rounded-2xl border border-ink-100 bg-white p-4">
                  <details open={i === 0 && j === 0}>
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${done ? "bg-brand-50 text-brand-600 ring-brand-200" : "bg-ink-50 text-ink-500 ring-ink-100"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <I className="h-4 w-4" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold text-ink-900">{j + 1}. {l.title}</span>
                        <span className="block text-[12.5px] text-ink-400">{LESSON_TYPE_META[l.contentType].label}{l.durationSec ? ` · ${fmtDuration(l.durationSec)}` : ""}{QUESTION_TYPES.includes(l.contentType) && l.questionCount !== undefined ? ` · ${l.questionCount} question${l.questionCount === 1 ? "" : "s"}` : ""}{l.isRequired === false ? " · optional" : ""}</span>
                      </span>
                      <StatusChip status={p?.status} />
                      {l.isRequired !== false && !done && <Lock className="h-3.5 w-3.5 text-ink-200" aria-hidden="true" />}
                    </summary>
                    <LessonBody lesson={l} courseId={courseId} progress={p} />
                  </details>
                </li>
              );
            })}
            {m.lessons.length === 0 && <li className="text-[13px] text-ink-400">No lessons in this module yet.</li>}
          </ol>
        </li>
      ))}
    </ol>
  );
}
