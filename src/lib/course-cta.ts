import { startReturnHref } from "@/lib/return-to";

/** The same union as `ViewerState` in course-public.service.ts, repeated here so client components can use it. */
export type CourseViewerState = "SIGNED_OUT" | "CAN_BUY" | "PENDING" | "OWNER" | "ENDED" | "NOT_TALENT";

export type CourseCta = { label: string; href: string; note: string | null; /** Show a "Log in" link after the note. */ logIn: string | null };

/**
 * The main button on a public course page for each kind of visitor. A signed-out visitor is sent to sign up with the
 * course remembered (the dashboard brings them back); signed-in talent go to the course page in the app to enrol and pay.
 * The cached page renders the signed-out version for everyone; the viewer panel swaps it once it knows who is looking.
 */
export function courseCta(state: CourseViewerState, course: { id: string; priceCents: number }): CourseCta {
  const buy = course.priceCents === 0 ? "Enrol for free" : "Buy course";
  const appHref = `/courses/${course.id}`;
  const buyHref = `${appHref}/buy`;
  switch (state) {
    case "SIGNED_OUT":
      return { label: buy, href: startReturnHref(course.id, "register", "buy"), note: "Create your account with just your name, email and a password, and you come straight back to check out. Already have an account?", logIn: startReturnHref(course.id, "login", "buy") };
    case "CAN_BUY":
      return { label: buy, href: buyHref, note: null, logIn: null };
    case "PENDING":
      return { label: "Complete your payment", href: buyHref, note: "You are enrolled; the lessons unlock when your payment is confirmed.", logIn: null };
    case "OWNER":
      return { label: "Continue learning", href: appHref, note: "You own this course.", logIn: null };
    case "ENDED":
      return { label: "View course", href: appHref, note: "Your access to this course has ended.", logIn: null };
    default:
      return { label: "", href: "", note: "Courses are for talent accounts.", logIn: null };
  }
}
