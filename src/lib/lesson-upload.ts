/**
 * Lesson file uploads: what is allowed and how the browser describes a file to the server. Shared by the editor (to check
 * a file before any request is made) and the service (which enforces the same rules). Pure, no imports.
 */

export const LESSON_UPLOAD_RULES = {
  VIDEO: { maxBytes: 500 * 1024 * 1024, mimes: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } },
  AUDIO: { maxBytes: 100 * 1024 * 1024, mimes: { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm", "audio/ogg": "ogg" } },
  DOCUMENT: { maxBytes: 50 * 1024 * 1024, mimes: { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx", "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "text/plain": "txt", "text/csv": "csv" } },
} as const;

export type LessonUploadKind = keyof typeof LESSON_UPLOAD_RULES;

/** File extensions browsers and phones commonly give files whose MIME type they leave empty or report unusually. */
const EXTENSION_MIME: Record<LessonUploadKind, Record<string, string>> = {
  VIDEO: { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm" },
  AUDIO: { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", webm: "audio/webm" },
  DOCUMENT: { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv" },
};

/** The `accept` attribute for the file picker: the MIME types and the extensions, so a file with a blank type still shows. */
export function acceptFor(kind: LessonUploadKind): string {
  return [...Object.keys(LESSON_UPLOAD_RULES[kind].mimes), ...Object.keys(EXTENSION_MIME[kind]).map((e) => `.${e}`)].join(",");
}

/** The MIME type to send for a chosen file: its own when allowed, otherwise taken from its extension, otherwise null. */
export function uploadMimeFor(file: { name: string; type: string }, kind: LessonUploadKind): string | null {
  const allowed = LESSON_UPLOAD_RULES[kind].mimes as Record<string, string>;
  if (file.type && allowed[file.type]) return file.type;
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_MIME[kind][ext] ?? null;
}

export const formatMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** What is wrong with a file before anything is sent, in words an editor can act on; null when it is fine. */
export function checkUploadFile(file: { name: string; type: string; size: number }, kind: LessonUploadKind): string | null {
  const rule = LESSON_UPLOAD_RULES[kind];
  const label = kind === "VIDEO" ? "video" : kind === "AUDIO" ? "audio" : "document";
  if (file.size <= 0) return "That file is empty.";
  if (!uploadMimeFor(file, kind)) {
    const exts = [...new Set(Object.values(rule.mimes))].join(", ").toUpperCase();
    return `This file type is not supported for a ${label} lesson. Use ${exts}.`;
  }
  if (file.size > rule.maxBytes) return `This file is ${formatMb(file.size)}. The maximum for a ${label} is ${formatMb(rule.maxBytes)}. Compress it or upload it in a smaller size.`;
  return null;
}

/**
 * What to tell the editor when the browser's direct upload to storage fails. Status 0 means the browser never got an
 * answer from storage: a blocked connection, or storage not allowing uploads from this website (a CORS setting).
 */
export function describeUploadFailure(status: number): string {
  if (status === 0) return "The upload could not reach file storage. If your connection is fine, storage is probably not set to accept uploads from this website (its CORS setting); ask the site administrator to check it. See docs/runbook.md, \"Uploads need CORS on the bucket\".";
  if (status === 403) return "Storage refused the upload (403). The upload link may have expired or the storage keys are wrong. Try again; if it keeps happening, tell the site administrator.";
  if (status === 413) return "Storage says the file is too large (413).";
  return `Storage answered with an error (${status}). Try again; if it keeps happening, tell the site administrator.`;
}
