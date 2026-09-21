import { Reveal } from "@/components/ui/Reveal";

// Structural facts about the platform, not performance claims.
const stats = [
  { value: "6", label: "levels in the Hirewise verification ladder" },
  { value: "5", label: "kinds of evidence on every profile" },
  { value: "10", label: "steps in the managed hiring flow" },
  { value: "1", label: "price per candidate, set by Hirewise" },
];

export function StatsBar() {
  return (
    <section className="border-y border-ink-100 bg-ink-50/70">
      <div className="container-x grid divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 80} className="flex items-center gap-4 py-7 sm:px-6 first:pl-0 last:pr-0">
            <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-ink-900">
              {s.value}
            </span>
            <span className="max-w-[180px] text-[13.5px] leading-snug text-ink-500">{s.label}</span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
