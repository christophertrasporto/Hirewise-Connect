import { FileText, Headphones, Link2, Type, Video } from "lucide-react";

/** Shared between the coach editor (client) and the student view (server): labels, hints, icons, formatters. */
export type LessonContentType = "VIDEO" | "AUDIO" | "LINK" | "DOCUMENT" | "TEXT";

export const LESSON_TYPE_META: Record<LessonContentType, { label: string; hint: string; icon: typeof Video }> = {
  VIDEO: { label: "Video", hint: "Upload an MP4, WebM, or MOV (up to 500 MB) or paste a YouTube, Vimeo, or Loom link.", icon: Video },
  AUDIO: { label: "Audio", hint: "Upload an MP3, WAV, M4A, or OGG (up to 100 MB).", icon: Headphones },
  LINK: { label: "External link", hint: "Any web page, article, tool, or externally hosted lesson.", icon: Link2 },
  DOCUMENT: { label: "Document", hint: "PDF, Word, PowerPoint, Excel, or text (up to 50 MB).", icon: FileText },
  TEXT: { label: "Text lesson", hint: "Written content with headings, lists, and links (Markdown).", icon: Type },
};

export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function fmtDuration(sec: number | null | undefined) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} min${s ? ` ${s}s` : ""}` : `${s}s`;
}
