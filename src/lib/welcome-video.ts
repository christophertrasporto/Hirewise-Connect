/**
 * The welcome video: every course that goes live has one published, uploaded VIDEO lesson marked as a free preview. It is
 * the course's sales video, so anyone (signed out, or enrolled but unpaid) can watch it before buying. Whether someone may
 * watch it is still decided only by `canWatchLesson`; this file only decides whether a course HAS one.
 */

type WelcomeLesson = { status: string; isFreePreview: boolean; contentType?: string; storageKey?: string | null; url?: string | null; title?: string };
type WelcomeModule = { status: string; lessons: WelcomeLesson[] };

export const WELCOME_VIDEO_HELP = "Add a Welcome lesson: a video you upload, marked as a free preview, so visitors can watch it before they buy.";

/** True when a published module has a published, uploaded video lesson that is a free preview. */
export function hasWelcomeVideo(modules: WelcomeModule[]): boolean {
  return modules.some((m) => m.status === "PUBLISHED" && m.lessons.some((l) => l.status === "PUBLISHED" && l.isFreePreview && l.contentType === "VIDEO" && !!l.storageKey));
}

/** Why a course cannot go live yet, in words a coach can act on, or null when it has its welcome video. */
export function welcomeVideoProblem(modules: WelcomeModule[]): string | null {
  if (hasWelcomeVideo(modules)) return null;
  const previewVideos = modules.flatMap((m) => m.lessons.filter((l) => l.isFreePreview && l.contentType === "VIDEO").map((l) => ({ ...l, live: m.status === "PUBLISHED" && l.status === "PUBLISHED" })));
  if (previewVideos.some((l) => l.live && !l.storageKey)) return "The free preview video is an external link. Upload the video file as the course's welcome video; links are fine for the other lessons.";
  if (previewVideos.length > 0) return "The welcome video is not published yet. Publish its lesson, and the module it is in, so visitors can watch it.";
  return `This course has no welcome video. ${WELCOME_VIDEO_HELP}`;
}
