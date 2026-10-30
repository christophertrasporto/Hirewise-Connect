"use client";

import { useActionState } from "react";
import { savePublicDetailsAction, setFeaturedAction, reviewModerationAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import type { PublicDetailsView } from "@/server/services/public-course.service";

const faqText = (faq: PublicDetailsView["faq"]) => faq.map((f) => `${f.question}\n${f.answer}`).join("\n\n");

/** The Public page tab: what visitors read on the course page, the address, and whether the course is listed. */
export function PublicDetailsForm({ details, isAdmin }: { details: PublicDetailsView; isAdmin: boolean }) {
  const [state, action] = useActionState(savePublicDetailsAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="courseId" value={details.courseId} />
      {isAdmin && <input type="hidden" name="hideEnrolledCountPresent" value="1" />}

      <Field label="Course address" htmlFor="slug" error={fe.slug} hint="Lower-case letters, digits and hyphens. If you change it, the old address keeps working and redirects here.">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] text-ink-400">/academy/</span>
          <Input id="slug" name="slug" defaultValue={details.slug} invalid={!!fe.slug} className="min-w-0 flex-1" />
        </div>
      </Field>

      <Field label="Short pitch" htmlFor="pitch" error={fe.pitch} hint="One or two sentences shown on the course card and in search results (up to 280 characters).">
        <Textarea id="pitch" name="pitch" rows={2} maxLength={280} defaultValue={details.pitch} invalid={!!fe.pitch} />
      </Field>

      <Field label="What you will learn" htmlFor="learningPoints" error={fe.learningPoints} hint="One point per line, up to 10.">
        <Textarea id="learningPoints" name="learningPoints" rows={5} defaultValue={details.learningPoints.join("\n")} invalid={!!fe.learningPoints} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Who this course is for" htmlFor="audience" error={fe.audience}>
          <Textarea id="audience" name="audience" rows={4} defaultValue={details.audience} invalid={!!fe.audience} />
        </Field>
        <Field label="Requirements" htmlFor="requirements" error={fe.requirements}>
          <Textarea id="requirements" name="requirements" rows={4} defaultValue={details.requirements} invalid={!!fe.requirements} />
        </Field>
      </div>

      <Field label="Frequently asked questions" htmlFor="faq" error={fe.faq} hint="Separate entries with a blank line. The first line of each entry is the question; the lines under it are the answer. Up to 12.">
        <Textarea id="faq" name="faq" rows={8} defaultValue={faqText(details.faq)} invalid={!!fe.faq} />
      </Field>

      <Field label="Visibility" htmlFor="listing" hint="Unlisted courses can be opened by anyone with the link but never appear in the catalog, search, categories or the sitemap.">
        <Select id="listing" name="listing" defaultValue={details.listing}>
          <option value="LISTED">Listed: shown in the public catalog</option>
          <option value="UNLISTED">Unlisted: reachable by link only</option>
        </Select>
      </Field>

      {isAdmin && <Checkbox name="hideEnrolledCount" defaultChecked={details.hideEnrolledCount} label={<span><span className="font-semibold">Hide the enrolled count</span> <span className="text-ink-500">on the public course page</span></span>} />}

      <div className="flex items-center gap-3">
        <SubmitButton variant="primary" pendingText="Saving…">Save public page</SubmitButton>
        {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

export function FeaturedForm({ courseId, rank, canFeature }: { courseId: string; rank: number | null; canFeature: boolean }) {
  const [state, action] = useActionState(setFeaturedAction, idle);
  if (!canFeature) return <p className="text-[13.5px] text-ink-500">Only a published, listed course can be featured.</p>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <Field label="Featured rank" htmlFor="rank" hint="1 shows first. Leave empty to remove from the featured row.">
        <Input id="rank" name="rank" type="number" min={1} max={999} defaultValue={rank ?? ""} className="w-28" />
      </Field>
      <SubmitButton variant="dark" pendingText="Saving…" className="h-10">Save</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
    </form>
  );
}

export type ReviewRow = { id: string; rating: number; body: string | null; author: string; createdAt: Date; hidden: boolean; hiddenReason: string | null };

export function ReviewModeration({ courseId, reviews }: { courseId: string; reviews: ReviewRow[] }) {
  if (reviews.length === 0) return <p className="text-[13.5px] text-ink-500">No reviews yet. Learners with access can review a published course.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {reviews.map((r) => <ReviewItem key={r.id} courseId={courseId} r={r} />)}
    </ul>
  );
}

function ReviewItem({ courseId, r }: { courseId: string; r: ReviewRow }) {
  const [state, action] = useActionState(reviewModerationAction, idle);
  return (
    <li className="py-3">
      <p className="text-[14px] font-semibold text-ink-900">{"★".repeat(r.rating)}<span className="text-ink-300">{"★".repeat(5 - r.rating)}</span> <span className="ml-1 font-normal text-ink-500">{r.author}</span>{r.hidden && <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-semibold text-ink-600">Hidden</span>}</p>
      {r.body && <p className="mt-1 whitespace-pre-line text-[13.5px] text-ink-700">{r.body}</p>}
      {r.hidden && r.hiddenReason && <p className="mt-1 text-[12.5px] text-ink-400">Reason: {r.hiddenReason}</p>}
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="reviewId" value={r.id} />
        <input type="hidden" name="op" value={r.hidden ? "UNHIDE" : "HIDE"} />
        {!r.hidden && <Input name="reason" placeholder="Reason for hiding" aria-label="Reason for hiding" className="h-9 max-w-xs text-[13px]" />}
        <SubmitButton variant="outline" pendingText="Working…" className="h-9 text-[13px]">{r.hidden ? "Show again" : "Hide"}</SubmitButton>
      </form>
      {state.error && <div className="mt-2"><FormAlert>{state.error}</FormAlert></div>}
    </li>
  );
}
