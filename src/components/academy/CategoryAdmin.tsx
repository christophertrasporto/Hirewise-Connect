"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveCategoryAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, Input, SubmitButton } from "@/components/ui/Form";

export type CategoryRow = { id: string; name: string; slug: string; order: number; isActive: boolean; courseCount: number };

function CategoryForm({ row, onDone }: { row?: CategoryRow; onDone?: () => void }) {
  const [state, action] = useActionState(saveCategoryAction, idle);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Name" htmlFor={`cat-name-${row?.id ?? "new"}`} error={fe.name} className="min-w-[220px] flex-1">
        <Input id={`cat-name-${row?.id ?? "new"}`} name="name" defaultValue={row?.name ?? ""} placeholder="e.g. Cold Calling" invalid={!!fe.name} />
      </Field>
      <Field label="Order" htmlFor={`cat-order-${row?.id ?? "new"}`} error={fe.order} className="w-[110px]">
        <Input id={`cat-order-${row?.id ?? "new"}`} name="order" type="number" min={0} defaultValue={row?.order ?? 0} />
      </Field>
      <div className="pb-2"><Checkbox name="isActive" defaultChecked={row?.isActive ?? true} label="Active" /></div>
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">{row ? "Save" : <><Plus className="mr-1 h-4 w-4" /> Add category</>}</SubmitButton>
      {onDone && <button type="button" onClick={onDone} className="h-10 text-[13.5px] font-semibold text-ink-500">Cancel</button>}
      {state.error && <p className="w-full text-[12.5px] text-red-600">{state.error}</p>}
    </form>
  );
}

function Row({ row }: { row: CategoryRow }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="py-3"><CategoryForm row={row} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-[14px]">
      <div>
        <p className={row.isActive ? "font-semibold text-ink-900" : "font-semibold text-ink-400 line-through"}>{row.name}</p>
        <p className="text-[12.5px] text-ink-400">{row.slug} · order {row.order} · {row.courseCount} course{row.courseCount === 1 ? "" : "s"}{row.isActive ? "" : " · hidden from the builder"}</p>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700"><Pencil className="h-3.5 w-3.5" /> Edit</button>
    </li>
  );
}

/** Admin-managed categories. Deactivating hides a category from new courses; existing courses keep it. */
export function CategoryAdmin({ rows }: { rows: CategoryRow[] }) {
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-ink-100">{rows.map((r) => <Row key={r.id} row={r} />)}</ul>
      <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4"><CategoryForm /></div>
    </div>
  );
}
