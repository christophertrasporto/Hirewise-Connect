"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Columns3 } from "lucide-react";
import { Checkbox } from "@/components/ui/Form";

export function CompareSelect({ ids }: { ids: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(ids.slice(0, Math.min(4, ids.length)).map((i) => i.id));
  return (
    <details className="relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full bg-ink-900 px-5 text-[14.5px] font-semibold text-white hover:bg-ink-800 [&::-webkit-details-marker]:hidden">
        <Columns3 className="h-4 w-4" /> Compare ({chosen.length})
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-ink-100 bg-white p-4 shadow-lift">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Choose up to 4</p>
        <div className="space-y-1.5">
          {ids.map((i) => (
            <Checkbox key={i.id} checked={chosen.includes(i.id)} disabled={!chosen.includes(i.id) && chosen.length >= 4} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, i.id] : c.filter((x) => x !== i.id)))} label={i.name} />
          ))}
        </div>
        <button type="button" disabled={chosen.length < 2} onClick={() => router.push(`/shortlist/compare?ids=${chosen.join(",")}`)} className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full bg-brand-500 text-[13.5px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
          Open comparison
        </button>
      </div>
    </details>
  );
}
