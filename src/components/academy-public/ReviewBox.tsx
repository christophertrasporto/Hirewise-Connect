"use client";

import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import { writeReviewAction } from "@/app/(app)/academy-actions";
import { FormAlert, SubmitButton, Textarea } from "@/components/ui/Form";
import type { ActionResult } from "@/server/http/action-result";
import { cn } from "@/lib/cn";
import { useCourseViewer } from "./use-course-viewer";

const idle: ActionResult = { ok: false };

/**
 * "Rate this course" for a learner who owns it. Shown only once the page knows the visitor owns the course (everyone
 * else sees nothing, and the server refuses anyone else anyway). A second save edits the same review.
 */
export function ReviewBox({ courseId }: { courseId: string }) {
  const viewer = useCourseViewer(courseId);
  const [state, action] = useActionState(writeReviewAction, idle);
  const [rating, setRating] = useState<number | null>(null);
  if (viewer?.state !== "OWNER") return null;
  const value = rating ?? viewer.myReview?.rating ?? 0;

  return (
    <form action={action} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
      <h3 className="text-[16px] font-bold text-ink-900">{viewer.myReview ? "Your review" : "Rate this course"}</h3>
      <p className="mt-1 text-[13px] text-ink-500">Shown as your first name and last initial.</p>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="rating" value={value || ""} />
      <div role="group" aria-label="Your rating from 1 to 5 stars" className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => setRating(n)} className="rounded-md p-0.5 focus-visible:ring-2 focus-visible:ring-brand-500">
            <Star fill={n <= value ? "currentColor" : "none"} className={cn("h-7 w-7 transition", n <= value ? "text-gold-500" : "text-ink-300 hover:text-gold-400")} aria-hidden="true" />
            <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
      <label htmlFor="review-body" className="mt-3 block text-[13px] font-semibold text-ink-700">
        Your review (optional)
      </label>
      <Textarea id="review-body" name="body" rows={4} maxLength={2000} defaultValue={viewer.myReview?.body ?? ""} className="mt-1" />
      <div className="mt-3 flex items-center gap-3">
        <SubmitButton pendingText="Saving…" disabled={value === 0}>
          {viewer.myReview ? "Update review" : "Post review"}
        </SubmitButton>
        {state.ok && <span role="status" className="text-[13px] font-semibold text-brand-700">Saved. It appears on this page in a few minutes.</span>}
      </div>
      {!state.ok && state.error && (
        <div className="mt-3">
          <FormAlert>{state.error}</FormAlert>
        </div>
      )}
    </form>
  );
}
