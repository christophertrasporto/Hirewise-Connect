import { cn } from "@/lib/cn";

/** A profile photo from the access-checked photo route, or the initials when there is none. */
export function Avatar({ agentProfileId, version, name, size = 40, className }: { agentProfileId: string; version: string | null; name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const box = { width: size, height: size };
  if (!version) {
    return (
      <span style={box} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700", className)} aria-hidden="true">
        <span style={{ fontSize: Math.max(11, Math.round(size / 3)) }}>{initials}</span>
      </span>
    );
  }
  // The photo route redirects to a signed storage URL, which next/image cannot optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/profile-photo/${agentProfileId}?v=${version}`} alt={`${name}, profile photo`} style={box} className={cn("shrink-0 rounded-full object-cover", className)} loading="lazy" decoding="async" />;
}
