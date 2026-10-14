"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/Form";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/cn";

export type TermsSectionProp = { key: string; title: string; number: number; bodyMarkdown: string; relevant: boolean };
export type TermsDocProp = { id: string; type: string; version: number; title: string; effectiveFrom: Date | string; sections: TermsSectionProp[]; changeNote?: string | null };
export type TermsBundleProp = { terms: TermsDocProp | null; privacy: TermsDocProp | null; checkboxLabel: string };

function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The reader: table of contents, in-document search, expandable sections, with the reader's relevant sections
 * opened and marked. Used inside the sign-up drawer and on the public /terms and /privacy pages.
 */
export function TermsDocument({ doc, highlight = true, compact = false }: { doc: TermsDocProp; highlight?: boolean; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(doc.sections.map((s) => [s.key, highlight ? s.relevant : true])));
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => (needle ? doc.sections.filter((s) => s.title.toLowerCase().includes(needle) || s.bodyMarkdown.toLowerCase().includes(needle)) : doc.sections), [doc.sections, needle]);
  useEffect(() => {
    if (needle) setOpen((o) => ({ ...o, ...Object.fromEntries(visible.map((s) => [s.key, true])) }));
  }, [needle, visible]);
  const jump = (key: string) => {
    setOpen((o) => ({ ...o, [key]: true }));
    requestAnimationFrame(() => document.getElementById(`${doc.type}-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className={cn("grid gap-6", !compact && "lg:grid-cols-[240px_1fr]")}>
      <aside className={cn("space-y-3", !compact && "lg:sticky lg:top-4 lg:self-start")}>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this document" aria-label="Search this document" className="h-10 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[13.5px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </label>
        <nav aria-label="Contents" className={cn("max-h-[260px] overflow-y-auto rounded-2xl border border-ink-100 bg-ink-50/60 p-2", !compact && "lg:max-h-[60vh]")}>
          <ol className="space-y-0.5">
            {doc.sections.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => jump(s.key)} className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white", highlight && s.relevant ? "font-semibold text-ink-900" : "text-ink-500")}>
                  <span className="w-5 shrink-0 tabular-nums text-ink-400">{s.number}.</span>
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        {highlight && <p className="text-[12px] text-ink-400">Sections marked “Relevant to you” are opened first. The acceptance covers the whole document.</p>}
      </aside>
      <div className="min-w-0 space-y-2">
        <p className="text-[12.5px] text-ink-400">Version {doc.version} · effective {fmt(doc.effectiveFrom)}{needle ? ` · ${visible.length} of ${doc.sections.length} sections match` : ""}</p>
        {visible.length === 0 && <p className="rounded-2xl border border-dashed border-ink-200 p-6 text-center text-[13.5px] text-ink-500">No section mentions “{q}”.</p>}
        {visible.map((s) => (
          <section key={s.key} id={`${doc.type}-${s.key}`} className={cn("rounded-2xl border bg-white", highlight && s.relevant ? "border-brand-200" : "border-ink-100")}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))} aria-expanded={!!open[s.key]} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="w-6 shrink-0 text-[13px] font-bold tabular-nums text-ink-400">{s.number}.</span>
              <span className="flex-1 text-[14.5px] font-semibold text-ink-900">{s.title}</span>
              {highlight && s.relevant && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Relevant to you</span>}
              <span className="text-[12px] text-ink-400">{open[s.key] ? "Hide" : "Show"}</span>
            </button>
            {open[s.key] && <div className="space-y-3 border-t border-ink-100 px-4 py-4 text-[14px]">{renderMarkdown(s.bodyMarkdown)}</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Slide-over reader that keeps the page underneath (and its form state) intact. */
export function TermsDrawer({ doc, onClose }: { doc: TermsDocProp; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={doc.title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-900/40" />
      <div className="relative flex h-full w-full max-w-[920px] flex-col bg-ink-50 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 bg-white px-5 py-4">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-brand-600">Full text</p>
            <h2 className="text-[18px] font-bold leading-tight text-ink-900">{doc.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-500 hover:bg-ink-50 hover:text-ink-900" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5"><TermsDocument doc={doc} /></div>
        <footer className="border-t border-ink-100 bg-white px-5 py-3 text-right">
          <button type="button" onClick={onClose} className="rounded-full bg-ink-900 px-5 py-2 text-[13.5px] font-semibold text-white hover:bg-ink-800">Back to the form</button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The one acceptance checkbox for sign-up and re-acceptance. "View Full Terms" opens the drawer in place so the
 * person returns to the form with everything they typed still there.
 */
export function TermsCheckbox({ bundle, error, name = "termsAccepted", extra }: { bundle: TermsBundleProp; error?: string; name?: string; extra?: ReactNode }) {
  const [openDoc, setOpenDoc] = useState<"terms" | "privacy" | null>(null);
  const doc = openDoc === "terms" ? bundle.terms : openDoc === "privacy" ? bundle.privacy : null;
  if (!bundle.terms) return <p className="rounded-2xl border border-gold-200 bg-gold-50 p-4 text-[13.5px] text-gold-800">The platform terms are not published yet. Sign-up is paused until Hirewise publishes them.</p>;
  return (
    <div className={cn("rounded-2xl border p-4", error ? "border-red-300 bg-red-50/40" : "border-ink-100 bg-ink-50/60")}>
      <Checkbox name={name} label={<span className="text-[13.5px] leading-snug text-ink-800">{bundle.checkboxLabel}</span>} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-[12.5px]">
        <button type="button" onClick={() => setOpenDoc("terms")} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:text-brand-800"><BookOpen className="h-3.5 w-3.5" /> View Full Terms (v{bundle.terms.version})</button>
        {bundle.privacy && <button type="button" onClick={() => setOpenDoc("privacy")} className="font-semibold text-brand-700 hover:text-brand-800">Privacy Policy (v{bundle.privacy.version})</button>}
        {extra}
      </div>
      {error && <p id={`${name}-error`} className="mt-2 pl-7 text-[12.5px] font-medium text-red-600">{error}</p>}
      {doc && <TermsDrawer doc={doc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}
