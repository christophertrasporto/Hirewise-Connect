import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

/** Five stars for a 1 to 5 rating, with the number and the count when given. The stars are decorative; the text carries the meaning. */
export function StarRating({ value, count, size = "sm", className }: { value: number | null; count?: number; size?: "sm" | "md"; className?: string }) {
  if (value === null || (count !== undefined && count === 0)) return <span className={cn("text-[12.5px] text-ink-400", className)}>No reviews yet</span>;
  const px = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-ink-700", className)}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} fill={i <= Math.round(value) ? "currentColor" : "none"} className={cn(px, i <= Math.round(value) ? "text-gold-500" : "text-ink-200")} />
        ))}
      </span>
      <span className="font-semibold">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-ink-400">({count.toLocaleString("en-US")})</span>}
      <span className="sr-only">out of 5 stars{count !== undefined ? `, ${count} review${count === 1 ? "" : "s"}` : ""}</span>
    </span>
  );
}
