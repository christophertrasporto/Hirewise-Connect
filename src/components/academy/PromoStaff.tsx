"use client";

import { useActionState, useState } from "react";
import { createPromoAction, setPromoStatusAction, updatePromoAction } from "@/app/(app)/promo-actions";
import { idle } from "@/server/http/action-result";
import { generateCode } from "@/lib/promo";
import type { PromoStaffView } from "@/server/services/promo.service";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

type CourseOption = { id: string; title: string; currency: string };

/** Create or edit a code. A code's name cannot change once it exists; everything else can. */
export function PromoForm({ promo, courses }: { promo?: PromoStaffView; courses: CourseOption[] }) {
  const [state, action] = useActionState(promo ? updatePromoAction : createPromoAction, idle);
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(promo?.discountType ?? "PERCENT");
  const [appliesTo, setAppliesTo] = useState<"ALL_COURSES" | "SELECTED_COURSES">(promo?.appliesTo ?? "ALL_COURSES");
  const [code, setCode] = useState(promo?.code ?? "");
  const fe = state.fieldErrors ?? {};
  const p = promo;
  const id = (n: string) => `${p?.id ?? "new"}-${n}`;
  return (
    <form action={action} className="space-y-4" noValidate>
      {p && <input type="hidden" name="promoId" value={p.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          htmlFor={id("code")}
          error={fe.code}
          hint={p ? "A code cannot be renamed" : "Letters, numbers, dashes. Shown to learners in capitals."}
          trailing={!p ? <button type="button" onClick={() => setCode(generateCode())} className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">Generate</button> : undefined}
        >
          <Input id={id("code")} name="code" value={code} onChange={(e) => setCode(e.target.value)} readOnly={!!p} invalid={!!fe.code} className="uppercase" autoComplete="off" />
        </Field>
        <Field label="Name for staff" htmlFor={id("label")} error={fe.label} hint="For example: Launch week, partner webinar">
          <Input id={id("label")} name="label" defaultValue={p?.label} invalid={!!fe.label} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Discount" htmlFor={id("type")}>
          <Select id={id("type")} name="discountType" value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "AMOUNT")}>
            <option value="PERCENT">Percentage off</option>
            <option value="AMOUNT">Fixed amount off</option>
          </Select>
        </Field>
        {type === "PERCENT" ? (
          <Field label="Percent" htmlFor={id("percent")} error={fe.percent} hint="100 makes the course free">
            <Input id={id("percent")} name="percent" inputMode="decimal" defaultValue={p?.percent} invalid={!!fe.percent} />
          </Field>
        ) : (
          <>
            <Field label="Amount" htmlFor={id("amount")} error={fe.amount}>
              <Input id={id("amount")} name="amount" inputMode="decimal" defaultValue={p?.amount} invalid={!!fe.amount} />
            </Field>
            <Field label="Currency" htmlFor={id("currency")} hint="Only courses in this currency">
              <Select id={id("currency")} name="currency" defaultValue={p?.currency ?? "PHP"}>
                <option value="PHP">PHP</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          </>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="First day" htmlFor={id("startsOn")} error={fe.startsOn} hint="Optional, Manila time">
          <Input id={id("startsOn")} name="startsOn" type="date" defaultValue={p?.startsOn} />
        </Field>
        <Field label="Last day" htmlFor={id("endsOn")} error={fe.endsOn} hint="Optional, inclusive">
          <Input id={id("endsOn")} name="endsOn" type="date" defaultValue={p?.endsOn} invalid={!!fe.endsOn} />
        </Field>
        <Field label="Total uses" htmlFor={id("max")} error={fe.maxRedemptions} hint="Empty means no limit">
          <Input id={id("max")} name="maxRedemptions" inputMode="numeric" defaultValue={p?.maxRedemptions ?? ""} invalid={!!fe.maxRedemptions} />
        </Field>
        <Field label="Uses per learner" htmlFor={id("per")} error={fe.perLearnerLimit}>
          <Input id={id("per")} name="perLearnerLimit" inputMode="numeric" defaultValue={p?.perLearnerLimit ?? 1} invalid={!!fe.perLearnerLimit} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Minimum course price" htmlFor={id("min")} error={fe.minPrice} hint="Optional">
          <Input id={id("min")} name="minPrice" inputMode="decimal" defaultValue={p?.minPrice} invalid={!!fe.minPrice} />
        </Field>
        <Field label="Applies to" htmlFor={id("applies")}>
          <Select id={id("applies")} name="appliesTo" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as "ALL_COURSES" | "SELECTED_COURSES")}>
            <option value="ALL_COURSES">All courses</option>
            <option value="SELECTED_COURSES">Selected courses</option>
          </Select>
        </Field>
      </div>
      {appliesTo === "SELECTED_COURSES" && (
        <fieldset className="rounded-xl border border-ink-100 p-3">
          <legend className="px-1 text-[13px] font-semibold text-ink-700">Courses</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[13.5px] text-ink-700">
                <input type="checkbox" name="courseIds" value={c.id} defaultChecked={p?.courses.some((x) => x.id === c.id)} className="h-4 w-4 rounded border-ink-300 accent-brand-600" /> {c.title} <span className="text-ink-400">({c.currency})</span>
              </label>
            ))}
          </div>
          {fe.courseIds && <p className="mt-2 text-[12.5px] text-red-600">{fe.courseIds}</p>}
        </fieldset>
      )}
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">{p ? "Saved." : "Code created."}</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10">{p ? "Save changes" : "Create code"}</SubmitButton>
    </form>
  );
}

export function PromoStatusButtons({ promoId, status }: { promoId: string; status: PromoStaffView["status"] }) {
  const [state, action] = useActionState(setPromoStatusAction, idle);
  const next: Array<{ to: string; label: string }> = status === "ACTIVE" ? [{ to: "PAUSED", label: "Pause" }] : status === "PAUSED" ? [{ to: "ACTIVE", label: "Resume" }] : [];
  if (status !== "ARCHIVED") next.push({ to: "ARCHIVED", label: "Archive" });
  if (!next.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {next.map((n) => (
        <form key={n.to} action={action}>
          <input type="hidden" name="promoId" value={promoId} />
          <input type="hidden" name="status" value={n.to} />
          <SubmitButton variant={n.to === "ARCHIVED" ? "danger" : "outline"} pendingText="…" className="h-8 px-3 text-[12px]">{n.label}</SubmitButton>
        </form>
      ))}
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </div>
  );
}
