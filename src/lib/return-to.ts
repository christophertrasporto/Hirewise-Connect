/**
 * "Return to the course after sign-up". A visitor who clicks Buy course on a public course page is sent to sign up or log
 * in, and once every gate is passed (email, terms, two-factor) the dashboard sends them back to that course. The
 * destination travels in a first-party cookie, not in the URL, so it survives the verification email and the gate
 * pages. Only course pages are ever allowed as a destination, which keeps this from becoming an open redirect.
 */

export const RETURN_COOKIE = "hw_return";
/** Long enough to verify an email and come back the same day. */
export const RETURN_COOKIE_MAX_AGE = 24 * 60 * 60;

const COURSE_PATH = /^\/(?:academy\/)?courses\/([A-Za-z0-9_-]{8,40})$/;

/**
 * The learner's course page (`/courses/<id>`) for a public or app course path, or null for anything else. Query strings
 * and fragments are dropped; absolute URLs, protocol-relative paths, dot segments, encoded tricks, and every path that
 * is not exactly a course page are refused.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim();
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  const m = COURSE_PATH.exec(p);
  return m ? `/courses/${m[1]}` : null;
}

/** The link a signed-out visitor follows from a course page: sets the return cookie, then goes to sign-up or login. */
export function startReturnHref(courseId: string, next: "register" | "login"): string {
  return `/api/return/start?to=${encodeURIComponent(`/courses/${courseId}`)}&next=${next}`;
}
