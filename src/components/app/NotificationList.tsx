import { markReadAction } from "@/app/(app)/actions";
import { EmptyState } from "@/components/app/ui";
import { cn } from "@/lib/cn";

type Item = { id: string; title: string; body: string; readAt: Date | null; createdAt: Date };

export function NotificationList({ items, compact = false }: { items: Item[]; compact?: boolean }) {
  if (items.length === 0) return <EmptyState title="You're all caught up" />;
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((n) => (
        <li key={n.id} className={cn("flex items-start gap-3 py-3", !n.readAt && "bg-brand-50/40 -mx-2 rounded-xl px-2")}>
          <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-ink-200" : "bg-brand-500")} />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold text-ink-800">{n.title}</p>
            {!compact && <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-600">{n.body}</p>}
            {compact && <p className="mt-0.5 truncate text-[13px] text-ink-500">{n.body}</p>}
            <p className="mt-1 text-[12px] text-ink-400">{new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
          </div>
          {!n.readAt && (
            <form action={markReadAction}>
              <input type="hidden" name="id" value={n.id} />
              <button type="submit" className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">Mark read</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
