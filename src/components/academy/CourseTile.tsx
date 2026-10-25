import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { coverAccent, difficultyLabel } from "@/lib/course-cover";

type CoverProps = { title: string; category: string; difficulty?: string | null; coverUrl?: string | null };

/**
 * 16:9 course cover. An uploaded image when there is one, otherwise a generated Hirewise navy cover with the title,
 * the category (accent color is stable per category), and the difficulty, so no card is ever blank.
 * The title is always rendered as text next to the cover, so the image itself is decorative (empty alt).
 */
export function CourseCover({ title, category, difficulty, coverUrl, className, reserveRight = false, eager = false, children }: CoverProps & { className?: string; reserveRight?: boolean; eager?: boolean; children?: ReactNode }) {
  const accent = coverAccent(category);
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden bg-ink-900", className)}>
      {coverUrl ? (
        // Signed storage URLs are not in next/image's remotePatterns; a plain img keeps covers working on any storage driver.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" loading={eager ? "eager" : "lazy"} decoding="async" />
      ) : (
        <div className="cover-navy cover-grid absolute inset-0" aria-hidden="true">
          <div className="absolute -right-10 -bottom-12 h-44 w-44 rounded-full opacity-25 blur-2xl" style={{ background: accent }} />
          <div className="relative flex h-full flex-col justify-between p-5 text-white">
            <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.12em] uppercase ring-1 ring-white/15 ring-inset", reserveRight ? "max-w-[calc(100%-8.5rem)]" : "max-w-full")}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
              <span className="truncate">{category}</span>
            </span>
            <p className="font-display line-clamp-3 text-[clamp(1.05rem,2.2vw,1.45rem)] leading-[1.1] font-extrabold tracking-tight uppercase">{title}</p>
            <p className="self-end text-right text-[11px] font-medium tracking-[0.1em] text-white/60 uppercase">{difficultyLabel(difficulty) ?? "Hirewise Academy"}</p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

const PILL_TONES = {
  neutral: "bg-white/95 text-ink-700 ring-ink-200",
  draft: "bg-ink-600/90 text-white ring-white/20",
  warn: "bg-gold-50 text-gold-800 ring-gold-200",
  good: "bg-brand-50 text-brand-700 ring-brand-200",
} as const;

export type TilePill = { label: string; tone?: keyof typeof PILL_TONES; icon?: ReactNode };

/** One card for every course surface (catalog, my courses, builder): cover, pill, action chip, title, description, footer. */
export function CourseTile({ href, cover, pill, action, title, description, footer, dimmed = false }: { href: string; cover: CoverProps; pill?: TilePill | null; action?: string | null; title: string; description?: string | null; footer?: ReactNode; dimmed?: boolean }) {
  return (
    <Link href={href} className={cn("group flex flex-col overflow-hidden rounded-card border border-ink-100 bg-surface-raised shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-offset-2", dimmed && "opacity-90")}>
      <CourseCover {...cover} reserveRight={!!pill}>
        {pill && (
          <span className={cn("absolute top-3 right-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold shadow-sm ring-1 backdrop-blur-sm ring-inset", PILL_TONES[pill.tone ?? "neutral"])}>
            {pill.icon}
            {pill.label}
          </span>
        )}
        {action && <span className="absolute bottom-3 left-3 rounded-lg bg-white px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-ink-900 uppercase shadow-sm transition group-hover:bg-brand-50 group-hover:text-brand-700">{action}</span>}
      </CourseCover>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-[17px] leading-snug font-bold text-ink-900 group-hover:text-brand-700">{title}</h3>
        {description ? <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-600">{description}</p> : null}
        {footer ? <div className="mt-auto pt-4">{footer}</div> : null}
      </div>
    </Link>
  );
}

/** The green pill progress bar with the percentage inside, as in the reference design. */
export function ProgressPill({ percent, complete = false }: { percent: number; complete?: boolean }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="relative h-7 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress">
      <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width]", complete ? "bg-brand-600" : "bg-brand-500")} style={{ width: p === 0 ? 0 : `${Math.max(p, 14)}%` }} />
      <span className={cn("relative flex h-full items-center pl-3 text-[12px] font-bold tabular-nums", p === 0 ? "text-ink-500" : "text-white")}>{p}%</span>
    </div>
  );
}
