import { ZodError } from "zod";
import { logger } from "@/server/logger";

/** Shape returned by every server action so forms can render errors uniformly. */
export type ActionResult<T = undefined> = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
};

/** Initial state for useActionState. Typed with `never` so it fits any ActionResult<T>. */
export const idle: ActionResult<never> = { ok: false };

type KnownError = Error & { status?: number; field?: string; permission?: string; missing?: string[]; retryAfterSeconds?: number };

/**
 * Map thrown errors to user-facing results. Forbidden and NotFound are reported
 * without detail so an action never becomes an oracle for other tenants' data.
 */
export function toActionError<T = undefined>(err: unknown): ActionResult<T> {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.map(String).join(".") || "_";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const e = err as KnownError;
  if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw err;
  switch (e?.name) {
    case "AuthError":
    case "RegistrationError":
    case "UploadRejectedError":
    case "IllegalTransitionError":
      return { ok: false, error: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
    case "SubmissionBlockedError":
      return { ok: false, error: `Not ready to submit: ${e.missing?.join("; ")}.` };
    case "RateLimitedError":
      return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((e.retryAfterSeconds ?? 60) / 60)} minute(s).` };
    case "ForbiddenError":
      return { ok: false, error: "You do not have permission to do that." };
    case "NotFoundError":
      return { ok: false, error: "That record was not found." };
    default:
      logger.error({ err }, "unhandled action error");
      return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Pull a string list out of FormData for multi-select or checkbox groups. */
export function formList(fd: FormData, name: string): string[] {
  return fd.getAll(name).map(String).map((s) => s.trim()).filter(Boolean);
}

export function formString(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}
