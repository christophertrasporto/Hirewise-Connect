"use client";

import { useActionState } from "react";
import { acceptTermsAction } from "@/app/(gate)/terms-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";
import { TermsCheckbox, TermsDocument, type TermsBundleProp } from "@/components/terms/TermsDrawer";

/**
 * The agreements gate for the unified terms: one checkbox, the full document inline, and a "what changed" note
 * when this is a re-acceptance of a material new version.
 */
export function TermsReacceptance({ bundle, reason, acceptedVersion }: { bundle: TermsBundleProp; reason: "NEW" | "MATERIAL_CHANGE" | null; acceptedVersion: number | null }) {
  const [state, action] = useActionState(acceptTermsAction, idle);
  const fe = state.fieldErrors ?? {};
  if (!bundle.terms) return <FormAlert>The platform terms are not published yet. Please try again later.</FormAlert>;
  return (
    <div className="mt-8 space-y-6">
      {reason === "MATERIAL_CHANGE" && (
        <div className="rounded-2xl border border-gold-200 bg-gold-50 p-4 text-[13.5px] text-gold-900">
          <p className="font-semibold">The Terms & Platform Agreement changed since you accepted version {acceptedVersion ?? "?"}.</p>
          <p className="mt-1">Version {bundle.terms.version} is a material update{bundle.terms.changeNote ? `: ${bundle.terms.changeNote}` : "."} Please read it and accept it once to continue.</p>
        </div>
      )}
      <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
        <TermsDocument doc={bundle.terms} />
      </div>
      <form action={action} className="space-y-4" noValidate>
        <TermsCheckbox bundle={bundle} error={fe.termsAccepted} />
        {state.error && !fe.termsAccepted && <FormAlert>{state.error}</FormAlert>}
        <SubmitButton pendingText="Recording…">Accept and continue</SubmitButton>
      </form>
    </div>
  );
}
