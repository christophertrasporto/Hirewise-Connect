import { startReturnHref } from "@/lib/return-to";
import { PARTNER_BUTTON_LABEL, PARTNER_DISCLOSURE } from "@/lib/partner-course";

/** The same union as `ViewerState` in course-public.service.ts, repeated here so client components can use it. */
export type CourseViewerState = "SIGNED_OUT" | "CAN_BUY" | "PENDING" | "OWNER" | "ENDED" | "NOT_TALENT";

export type CourseCta = { label: string; href: string; note: string | null; /** Show a "Log in" link after the note. */ logIn: string | null; /** A partner course: the button leaves the site, in a new tab. */ external: boolean };

/**
 * The main button on a public course page for each kind of visitor. A signed-out visitor is sent to sign up with the
 * course remembered (the dashboard brings them back); signed-in talent go to the course page in the app to enrol and pay.
 * The cached page renders the signed-out version for everyone; the viewer panel swaps it once it knows who is looking.
 */
export function courseCta(state: CourseViewerState, course: { id: string; priceCents: number; /** Set for a partner course (taught on another site). */ partner?: { goPath: string } | null }): CourseCta {
  // A partner course is the same for everyone, signed in or not: the button goes to the partner (through the click counter).
  if (course.partner) return { label: PARTNER_BUTTON_LABEL, href: course.partner.goPath, note: PARTNER_DISCLOSURE, logIn: null, external: true };
  const buy = course.priceCents === 0 ? "Enrol for free" : "Buy course";
  const appHref = `/courses/${course.id}`;
  const buyHref = `${appHref}/buy`;
  switch (state) {
    case "SIGNED_OUT":
      return { label: buy, href: startReturnHref(course.id, "register", "buy"), note: "Create your account with just your name, email and a password, and you come straight back to check out. Already have an account?", logIn: startReturnHref(course.id, "login", "buy"), external: false };
    case "CAN_BUY":
      return { label: buy, href: buyHref, note: null, logIn: null, external: false };
    case "PENDING":
      return { label: "Complete your payment", href: buyHref, note: "You are enrolled; the lessons unlock when your payment is confirmed.", logIn: null, external: false };
    case "OWNER":
      return { label: "Continue learning", href: appHref, note: "You own this course.", logIn: null, external: false };
    case "ENDED":
      return { label: "View course", href: appHref, note: "Your access to this course has ended.", logIn: null, external: false };
    default:
      return { label: "", href: "", note: "Courses are for talent accounts.", logIn: null, external: false };
  }
}
