"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateAgencyProfileAction } from "@/app/(app)/agency-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { COUNTRIES } from "@/lib/options";

export function AgencyProfileForm({ agency, disabled }: { agency: { id: string; name: string; description: string | null; contactEmail: string; contactPhone: string | null; country: string; city: string | null; website: string | null; legalName?: string | null; addressLine?: string | null; registrationDetails?: string | null; billingEmail?: string | null }; disabled: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(updateAgencyProfileAction, idle);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="agencyId" value={agency.id} />
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agency name" htmlFor="ag-name" error={fe.name} className="sm:col-span-2"><Input id="ag-name" name="name" defaultValue={agency.name} invalid={!!fe.name} /></Field>
          <Field label="Contact email" htmlFor="ag-email" error={fe.contactEmail}><Input id="ag-email" name="contactEmail" type="email" defaultValue={agency.contactEmail} invalid={!!fe.contactEmail} /></Field>
          <Field label="Contact phone (optional)" htmlFor="ag-phone" error={fe.contactPhone}><Input id="ag-phone" name="contactPhone" defaultValue={agency.contactPhone ?? ""} /></Field>
          <Field label="Country" htmlFor="ag-country" error={fe.country}><Select id="ag-country" name="country" defaultValue={agency.country}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="City (optional)" htmlFor="ag-city" error={fe.city}><Input id="ag-city" name="city" defaultValue={agency.city ?? ""} /></Field>
          <Field label="Website (optional)" htmlFor="ag-web" error={fe.website} className="sm:col-span-2"><Input id="ag-web" name="website" type="url" placeholder="https://" defaultValue={agency.website ?? ""} invalid={!!fe.website} /></Field>
        </div>
        <Field label="About the agency (optional)" htmlFor="ag-desc" error={fe.description} hint="Shown to Hirewise. Clients never see agency details."><Textarea id="ag-desc" name="description" rows={4} defaultValue={agency.description ?? ""} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name (optional)" htmlFor="ag-legal" error={fe.legalName} hint="Private: Hirewise only."><Input id="ag-legal" name="legalName" defaultValue={agency.legalName ?? ""} /></Field>
          <Field label="Billing email (optional)" htmlFor="ag-bill" error={fe.billingEmail}><Input id="ag-bill" name="billingEmail" type="email" defaultValue={agency.billingEmail ?? ""} invalid={!!fe.billingEmail} /></Field>
          <Field label="Business address (optional)" htmlFor="ag-addr" error={fe.addressLine}><Input id="ag-addr" name="addressLine" defaultValue={agency.addressLine ?? ""} /></Field>
          <Field label="Registration details (optional)" htmlFor="ag-reg" error={fe.registrationDetails} hint="Registration number, authority, or similar."><Input id="ag-reg" name="registrationDetails" defaultValue={agency.registrationDetails ?? ""} /></Field>
        </div>
        {state.error && <FormAlert>{state.error}</FormAlert>}
        {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
        <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
      </fieldset>
      {disabled && <p className="text-[12.5px] text-ink-400">Editing is paused while the agency is not active.</p>}
    </form>
  );
}
