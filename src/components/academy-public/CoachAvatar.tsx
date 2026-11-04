import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "C";
}

/** A coach photo from the public photo route, or their initials when they have not uploaded one. The name is always shown next to it. */
export function CoachAvatar({ name, photoUrl, className }: { name: string; photoUrl: string | null; className?: string }) {
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt="" loading="lazy" decoding="async" className={cn("h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-ink-100", className)} />
  ) : (
    <span aria-hidden="true" className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[17px] font-bold text-white", className)}>
      {initials(name)}
    </span>
  );
}
