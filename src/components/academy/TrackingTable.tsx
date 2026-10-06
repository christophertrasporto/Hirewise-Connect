import Link from "next/link";
import { StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import type { TrackingRow } from "@/server/services/tracking.service";

const STATUS_LABEL: Record<TrackingRow["status"], string> = { COMPLETED: "Completed", IN_PROGRESS: "In progress", FAILED: "Failed", NOT_STARTED: "Not started" };
const LESSON_STATUS: Record<string, string> = { NOT_STARTED: "not started", IN_PROGRESS: "in progress", COMPLETED: "completed", FAILED: "failed", RETAKE_REQUIRED: "retake required", PENDING_REVIEW: "awaiting review" };

/** Filters (GET form) and the tracking table. `fixedCourseId` hides the course filter on a course's own Progress tab. */
export function TrackingFilters({ courses, coaches, values, fixedCourseId, action }: { courses: Array<{ id: string; title: string }>; coaches: Array<{ userId: string; label: string }>; values: { courseId?: string; coachUserId?: string; status?: string; q?: string }; fixedCourseId?: string; action: string }) {
  const sel = "h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800";
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2">
      {!fixedCourseId && (
        <label className="text-[12px] font-semibold text-ink-500">Course<br /><select name="courseId" defaultValue={values.courseId ?? ""} className={sel}><option value="">All courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      )}
      {coaches.length > 1 && !fixedCourseId && (
        <label className="text-[12px] font-semibold text-ink-500">Coach<br /><select name="coachUserId" defaultValue={values.coachUserId ?? ""} className={sel}><option value="">All coaches</option>{coaches.map((c) => <option key={c.userId} value={c.userId}>{c.label}</option>)}</select></label>
      )}
      <label className="text-[12px] font-semibold text-ink-500">Status<br /><select name="status" defaultValue={values.status ?? ""} className={sel}><option value="">All</option><option value="COMPLETED">Completed</option><option value="IN_PROGRESS">In progress</option><option value="FAILED">Failed</option><option value="NOT_STARTED">Not started</option></select></label>
      <label className="text-[12px] font-semibold text-ink-500">Learner<br /><input name="q" defaultValue={values.q ?? ""} placeholder="Name or email" className={`${sel} w-[200px]`} /></label>
      <button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">Filter</button>
      {(values.courseId || values.coachUserId || values.status || values.q) && <Link href={action} className="h-10 rounded-full border border-ink-200 px-4 text-[13.5px] font-semibold leading-10 text-ink-700 hover:bg-ink-50">Clear</Link>}
    </form>
  );
}

export function TrackingTable({ rows, showCourse = true }: { rows: TrackingRow[]; showCourse?: boolean }) {
  if (rows.length === 0) return <EmptyState title="No learners match" description="Try another filter, or wait for enrolments." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-ink-100 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
            <th className="py-2 pr-3">Learner</th>
            {showCourse && <th className="px-2 py-2">Course</th>}
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Progress</th>
            <th className="px-2 py-2">Current lesson</th>
            <th className="px-2 py-2">Listening</th>
            <th className="px-2 py-2">Quizzes</th>
            <th className="px-2 py-2">Assignments</th>
            <th className="px-2 py-2">Completed</th>
            <th className="px-2 py-2">Certification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.enrollmentId} className="border-b border-ink-50 align-top">
              <td className="py-2.5 pr-3">
                <Link href={`/talent/${r.learner.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{r.learner.displayName}</Link>
                <span className="block text-[11.5px] text-ink-400">{r.learner.primaryRole ?? "Talent"} · enrolled {fmtDate(r.enrolledAt)}</span>
              </td>
              {showCourse && <td className="px-2 py-2.5"><Link href={`/courses/manage/${r.course.id}/progress`} className="font-medium text-ink-800 hover:text-brand-700">{r.course.title}</Link><span className="block text-[11.5px] text-ink-400">coach {r.course.coach}</span></td>}
              <td className="px-2 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset ${r.status === "COMPLETED" ? "bg-brand-50 text-brand-700 ring-brand-200" : r.status === "FAILED" ? "bg-red-50 text-red-700 ring-red-200" : r.status === "IN_PROGRESS" ? "bg-ink-50 text-ink-700 ring-ink-200" : "bg-white text-ink-400 ring-ink-200"}`}>{STATUS_LABEL[r.status]}</span>{r.paymentPending && <span className="block text-[11.5px] text-gold-700">payment pending</span>}</td>
              <td className="px-2 py-2.5 min-w-[120px]">
                <span className="font-semibold text-ink-900">{r.percent}%</span><span className="text-ink-400"> · {r.requiredDone}/{r.requiredTotal}</span>
                <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${r.percent}%` }} /></div>
              </td>
              <td className="px-2 py-2.5">{r.currentLesson ? <><span className="text-ink-800">{r.currentLesson.title}</span><span className="block text-[11.5px] text-ink-400">{r.currentModule} · {LESSON_STATUS[r.currentLesson.status] ?? r.currentLesson.status}</span></> : <span className="text-ink-300">—</span>}</td>
              <td className="px-2 py-2.5 text-ink-700">{r.listeningPercent === null ? <span className="text-ink-300">—</span> : `${r.listeningPercent}%`}</td>
              <td className="px-2 py-2.5">
                {r.quizzes.length === 0 ? <span className="text-ink-300">—</span> : (
                  <ul className="space-y-0.5">
                    {r.quizzes.map((q) => <li key={q.lessonId} className="whitespace-nowrap"><span className={q.passed ? "font-semibold text-brand-700" : q.pendingReview ? "font-semibold text-gold-700" : q.best !== null ? "font-semibold text-ink-700" : "text-ink-300"}>{q.pendingReview ? "review" : q.best !== null ? `${q.best}%` : "—"}</span><span className="text-ink-400"> · {q.attempts} att.</span><span className="block max-w-[160px] truncate text-[11px] text-ink-400" title={q.title}>{q.title}</span></li>)}
                  </ul>
                )}
              </td>
              <td className="px-2 py-2.5 text-ink-700">{r.assignments ? <>{r.assignments.graded}/{r.assignments.total} graded{r.assignments.awaitingReview ? <span className="block text-[11.5px] text-gold-700">{r.assignments.awaitingReview} awaiting review</span> : null}{r.assignments.returned ? <span className="block text-[11.5px] text-ink-400">{r.assignments.returned} returned</span> : null}</> : <span className="text-ink-300">—</span>}</td>
              <td className="px-2 py-2.5 text-ink-700">{r.completedAt ? fmtDate(r.completedAt) : <span className="text-ink-300">—</span>}{r.lastActivityAt && !r.completedAt && <span className="block text-[11.5px] text-ink-400">active {fmtDate(r.lastActivityAt)}</span>}</td>
              <td className="px-2 py-2.5">{r.certification ? <><StatusBadge status={r.certification.status} /><span className="block text-[11.5px] text-ink-400">{r.certification.certificateNumber ?? r.certification.name}</span></> : <span className="text-ink-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
