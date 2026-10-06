"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { restoreLessonVersionAction } from "@/app/(app)/version-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { EmptyState, fmtDate } from "@/components/app/ui";
import type { VersionRow } from "@/server/services/lesson-version.service";

function RestoreButton({ courseId, lessonId, version }: { courseId: string; lessonId: string; version: number }) {
  const router = useRouter();
  const [state, action] = useActionState(restoreLessonVersionAction, idle as ActionResult<{ version: number }>);
  if (state.ok) {
    setTimeout(() => router.refresh(), 300);
    return <span className="text-[12.5px] font-semibold text-brand-700">Restored as v{state.data?.version}</span>;
  }
  return (
    <form action={action} onSubmit={(e) => { if (!confirm(`Restore the content and settings of version ${version}? Questions are not restored. The restore is recorded as a new version.`)) e.preventDefault(); }}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="version" value={version} />
      <button type="submit" className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-ink-700 hover:bg-ink-50"><RotateCcw className="h-3.5 w-3.5" /> Restore</button>
      {state.error && <p className="mt-1 text-[12px] text-red-600">{state.error}</p>}
    </form>
  );
}

/** Lesson version history: who changed what, when, and what learners did on each version. */
export function LessonHistory({ courseId, lessonId, current, versions }: { courseId: string; lessonId: string; current: { version: number; attempts: number; completions: number; questionCount: number }; versions: VersionRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-brand-50/60 px-4 py-3 text-[13.5px] text-ink-700">
        <History className="h-4 w-4 text-brand-600" />
        <span><span className="font-semibold text-ink-900">Current: v{current.version}</span> · {current.questionCount} question{current.questionCount === 1 ? "" : "s"} · {current.attempts} attempt{current.attempts === 1 ? "" : "s"} and {current.completions} completion{current.completions === 1 ? "" : "s"} on this version</span>
      </div>
      {versions.length === 0 ? <EmptyState title="No earlier versions" description="Significant edits to the lesson or its questions are recorded here. Description changes are not." /> : (
        <ol className="divide-y divide-ink-100">
          {versions.map((v) => (
            <li key={v.version} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-ink-900">v{v.version} <span className="font-normal text-ink-400">· until {fmtDate(v.changedAt)}{v.changedBy ? ` · changed by ${v.changedBy}` : ""}</span></p>
                <div className="flex items-center gap-3 text-[12.5px] text-ink-500">
                  <span>{v.attempts} attempt{v.attempts === 1 ? "" : "s"} · {v.completions} completion{v.completions === 1 ? "" : "s"}</span>
                  <RestoreButton courseId={courseId} lessonId={lessonId} version={v.version} />
                </div>
              </div>
              {v.reason && <p className="text-[13px] text-ink-600">{v.reason}</p>}
              {v.changes.length > 0 && (
                <table className="w-full text-left text-[12.5px]">
                  <tbody>
                    {v.changes.map((c, i) => (
                      <tr key={i} className="border-t border-ink-50">
                        <td className="py-1 pr-3 font-semibold text-ink-700">{c.field}</td>
                        <td className="py-1 pr-3 text-ink-500"><span className="line-through decoration-ink-300">{c.from}</span></td>
                        <td className="py-1 text-ink-800">{c.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
