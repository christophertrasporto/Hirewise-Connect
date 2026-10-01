import Link from "next/link";
import { cn } from "@/lib/cn";

/** Brand green from the supplied logo artwork (public/brand/hirewise-connect-logo-dark.png). */
export const LOGO_GREEN = "#3FCB6B";

/**
 * The "H" mark: two stems with a green growth arrow sweeping up through the crossbar.
 * Stems use currentColor so the same mark works on light (ink) and dark (white) surfaces.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn("h-9 w-9", className)} fill="none">
      {/* left stem */}
      <rect x="6" y="15" width="8.5" height="27" rx="1.2" fill="currentColor" />
      {/* right stem */}
      <rect x="31" y="6" width="8.5" height="36" rx="1.2" fill="currentColor" />
      {/* arrow sweeping from the foot of the left stem up through the crossbar */}
      <path d="M10.25 42 C 10.25 30, 17 24.5, 29 19.5" stroke={LOGO_GREEN} strokeWidth="7.2" strokeLinecap="round" />
      <path d="M26.5 10.5 L44 6 L39.5 23.5 Z" fill={LOGO_GREEN} />
    </svg>
  );
}

/**
 * Full lock-up: mark, "HirewiseConnect.com", and the tagline from the brand artwork.
 * `inverted` is for dark surfaces. `tagline={false}` drops the strapline where space is tight.
 */
export function Logo({
  className,
  inverted = false,
  href = "/",
  tagline = true,
}: {
  className?: string;
  inverted?: boolean;
  href?: string;
  tagline?: boolean;
}) {
  const ink = inverted ? "text-white" : "text-ink-900";
  const muted = inverted ? "text-ink-300" : "text-ink-400";
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Hirewise Connect home">
      <LogoMark className={cn("shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5", ink)} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-[18px] font-extrabold tracking-tight", ink)}>
          Hirewise<span style={{ color: LOGO_GREEN }}>Connect</span>
          <span className={cn("font-semibold", muted)}>.com</span>
        </span>
        {tagline && (
          <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[8.5px] font-semibold uppercase tracking-[0.16em]", muted)}>
            {["Talent", "Learning", "Certification", "Opportunities"].map((word, i) => (
              <span key={word} className="inline-flex items-center gap-x-1.5">
                {i > 0 && <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full" style={{ background: LOGO_GREEN }} />}
                {word}
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
