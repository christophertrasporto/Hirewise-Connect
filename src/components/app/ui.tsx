import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { labelFor } from "@/lib/options";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>}
        <h1 className="mt-1.5 text-[1.85rem] font-bold leading-tight">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, children, className, actions }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-3xl border border-ink-100 bg-white p-6 shadow-soft", className)}>
      {(title || actions) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[17px] font-bold text-ink-900">{title}</h2>}
            {description && <p className="mt-1 text-[13.5px] text-ink-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 transition hover:border-ink-200 hover:shadow-soft">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</p>
      <p className="mt-2 font-display text-[2rem] font-extrabold leading-none text-ink-900">{value}</p>
      {hint && <p className="mt-2 text-[12.5px] text-ink-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const toneByStatus: Record<string, string> = {
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-200",
  ACTIVE: "bg-brand-50 text-brand-700 ring-brand-200",
  AVAILABLE: "bg-brand-50 text-brand-700 ring-brand-200",
  SUBMITTED: "bg-gold-50 text-gold-700 ring-gold-200",
  UNDER_REVIEW: "bg-gold-50 text-gold-700 ring-gold-200",
  PENDING_REVIEW: "bg-gold-50 text-gold-700 ring-gold-200",
  REVISION_REQUIRED: "bg-orange-50 text-orange-700 ring-orange-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  SUSPENDED: "bg-red-50 text-red-700 ring-red-200",
  HIDDEN: "bg-ink-100 text-ink-600 ring-ink-200",
  DRAFT: "bg-ink-100 text-ink-600 ring-ink-200",
  RETIRED: "bg-ink-100 text-ink-500 ring-ink-200",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset", toneByStatus[status] ?? "bg-ink-100 text-ink-600 ring-ink-200")}>{labelFor(status)}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-8 text-center">
      <p className="text-[15px] font-semibold text-ink-800">{title}</p>
      {description && <p className="mt-1 text-[13.5px] text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Banner({ tone = "info", title, children }: { tone?: "info" | "warn" | "success" | "danger"; title: string; children?: ReactNode }) {
  const cls = {
    info: "border-ink-200 bg-ink-50 text-ink-700",
    warn: "border-gold-200 bg-gold-50 text-gold-700",
    success: "border-brand-200 bg-brand-50 text-brand-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[tone];
  return (
    <div className={cn("rounded-2xl border px-5 py-4", cls)}>
      <p className="text-[14.5px] font-bold">{title}</p>
      {children && <div className="mt-1 text-[13.5px] leading-relaxed">{children}</div>}
    </div>
  );
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
