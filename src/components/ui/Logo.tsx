import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  // Unique gradient id per instance: the same mark can appear twice on a page
  // (for example inside a hidden panel), and duplicate SVG ids break the fill.
  const gradientId = `hw-g-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("h-9 w-9", className)} fill="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#21BC8A" />
          <stop offset="1" stopColor="#0B8663" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gradientId})`} />
      <path d="M12 11.5v17M28 11.5v17M12 20h16" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="28" cy="11.5" r="4.4" fill="#E8B44C" stroke="#0B8663" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({
  className,
  inverted = false,
  href = "/",
}: {
  className?: string;
  inverted?: boolean;
  href?: string;
}) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Hirewise Connect home">
      <LogoMark className="transition-transform duration-300 group-hover:-rotate-3" />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-[17px] font-bold tracking-tight", inverted ? "text-white" : "text-ink-900")}>
          Hirewise <span className={inverted ? "text-brand-300" : "text-brand-600"}>Connect</span>
        </span>
        <span className={cn("mt-1 text-[10px] font-medium uppercase tracking-[0.18em]", inverted ? "text-ink-300" : "text-ink-400")}>
          Verified talent marketplace
        </span>
      </span>
    </Link>
  );
}
