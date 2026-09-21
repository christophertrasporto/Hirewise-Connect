import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "brand" | "gold" | "ink" | "neutral" | "outline";

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200",
  gold: "bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-200",
  ink: "bg-ink-900 text-white",
  neutral: "bg-ink-100 text-ink-700",
  outline: "bg-white text-ink-700 ring-1 ring-inset ring-ink-200",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold tracking-wide",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function Eyebrow({ children, className, tone = "brand" }: { children: ReactNode; className?: string; tone?: "brand" | "light" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em]",
        tone === "brand" ? "text-brand-600" : "text-brand-300",
        className,
      )}
    >
      <span className={cn("h-px w-6", tone === "brand" ? "bg-brand-500" : "bg-brand-300")} />
      {children}
    </span>
  );
}
