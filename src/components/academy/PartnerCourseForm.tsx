"use client";

import { useActionState } from "react";
import { setPartnerLinkAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, SubmitButton } from "@/components/ui/Form";

/**
 * Admin only. Turns the course into a partner course: taught on another site and reached through an affiliate link. The
 * link is kept on the server; visitors only ever see the "Take this course" button, which counts the press and redirects.
 */
export function PartnerCourseForm({ courseId, link, provider, priceLabel }: { courseId: string; link: string | null; provider: string | null; priceLabel: string | null }) {
  const [state, action] = useActionState(setPartnerLinkAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <p className="text-[13.5px] leading-relaxed text-ink-500">
        Use this for a course taught on another site. Visitors watch the free welcome video here, then press <strong>Take this course</strong> and go to your affiliate link in a new tab. Nothing is sold or enrolled on Hirewise.
      </p>
      <Field label="Affiliate link" htmlFor="partner-url" error={fe.url} hint="The full address, starting with https://">
        <Input id="partner-url" name="url" type="url" defaultValue={link ?? ""} placeholder="https://" invalid={!!fe.url} />
      </Field>
      <Field label="Partner name" htmlFor="partner-provider" error={fe.provider} hint="Shown to visitors, for example Udemy.">
        <Input id="partner-provider" name="provider" defaultValue={provider ?? ""} maxLength={80} invalid={!!fe.provider} />
      </Field>
      <Field label="Partner price" htmlFor="partner-price" error={fe.priceLabel} hint="Shown as typed, for example “from $19” or “USD 49”. Leave empty to show only the partner name.">
        <Input id="partner-price" name="priceLabel" defaultValue={priceLabel ?? ""} maxLength={40} invalid={!!fe.priceLabel} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="op" value="SAVE" pendingText="Saving…">{link ? "Save partner link" : "Make this a partner course"}</SubmitButton>
        {link && (
          <SubmitButton name="op" value="REMOVE" variant="outline" pendingText="Removing…">Turn back into an ordinary course</SubmitButton>
        )}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
    </form>
  );
}
