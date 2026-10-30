"use client";

import { useActionState } from "react";
import { saveCoachProfileAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, SubmitButton, Textarea } from "@/components/ui/Form";
import type { CoachProfileView } from "@/server/services/coach-profile.service";

/** A coach's public identity: the name learners see, a short bio, links, and whether the page is public. */
export function CoachProfileForm({ profile, suggestedName }: { profile: CoachProfileView | null; suggestedName: string }) {
  const [state, action] = useActionState(saveCoachProfileAction, idle);
  const fe = state.fieldErrors ?? {};
  const links = Array.from({ length: 6 }, (_, i) => profile?.links[i] ?? { label: "", url: "" });
  return (
    <form action={action} className="space-y-5" noValidate>
      <Field label="Name learners see" htmlFor="displayName" error={fe.displayName}>
        <Input id="displayName" name="displayName" defaultValue={profile?.displayName ?? suggestedName} invalid={!!fe.displayName} />
      </Field>
      <Field label="Headline" htmlFor="headline" error={fe.headline} hint="For example: Appointment-setting coach with 10 years in B2B sales.">
        <Input id="headline" name="headline" defaultValue={profile?.headline ?? ""} maxLength={120} />
      </Field>
      <Field label="About you" htmlFor="bio" error={fe.bio}>
        <Textarea id="bio" name="bio" rows={6} defaultValue={profile?.bio ?? ""} maxLength={2000} />
      </Field>
      <Field label="Your page address" htmlFor="slug" error={fe.slug} hint={profile ? "If you change it, the old address keeps working and redirects." : "Leave empty to use your name."}>
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] text-ink-400">/coaches/</span>
          <Input id="slug" name="slug" defaultValue={profile?.slug ?? ""} invalid={!!fe.slug} className="min-w-0 flex-1" />
        </div>
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13.5px] font-semibold text-ink-800">Links (https only, up to 6)</legend>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <Input name={`linkLabel${i + 1}`} defaultValue={l.label} placeholder="Label, e.g. LinkedIn" aria-label={`Link ${i + 1} label`} />
              <Input name={`linkUrl${i + 1}`} defaultValue={l.url} placeholder="https://…" aria-label={`Link ${i + 1} address`} />
            </div>
          ))}
        </div>
      </fieldset>
      <Checkbox name="isPublic" defaultChecked={profile?.isPublic ?? false} label={<span><span className="font-semibold">Show my public coach page</span> <span className="text-ink-500">Your name and page appear only while you have a published, listed course.</span></span>} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="primary" pendingText="Saving…">Save profile</SubmitButton>
        {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
