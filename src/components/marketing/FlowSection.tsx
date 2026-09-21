import { GraduationCap, Building2, Landmark } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { flow } from "@/lib/site";
import { cn } from "@/lib/cn";

const owner = {
  talent: { label: "Talent", icon: GraduationCap, cls: "bg-gold-50 text-gold-700 ring-gold-200" },
  client: { label: "Client", icon: Building2, cls: "bg-brand-50 text-brand-700 ring-brand-200" },
  hirewise: { label: "Hirewise", icon: Landmark, cls: "bg-ink-900 text-white ring-ink-900" },
};

export function FlowSection() {
  return (
    <section id="flow" className="relative py-24 lg:py-32">
      <div className="container-x">
        <SectionHeading
          eyebrow="The Hirewise Connect flow"
          title={
            <>
              From training to deployment, <span className="font-serif font-normal italic text-brand-600">one managed path.</span>
            </>
          }
          description="Ten steps. Three parties. Hirewise stays in the middle of every commercial decision, so clients get certainty and talent gets a structured route from learning to employment."
        />

        <div className="mt-8 flex flex-wrap gap-2">
          {(Object.keys(owner) as Array<keyof typeof owner>).map((k) => {
            const o = owner[k];
            return (
              <span
                key={k}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ring-inset", o.cls)}
              >
                <o.icon className="h-3.5 w-3.5" /> {o.label}
              </span>
            );
          })}
        </div>

        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {flow.map((f, i) => {
            const o = owner[f.who];
            return (
              <Reveal as="li" key={f.step} delay={i * 60} className="group relative">
                <div className="relative h-full rounded-2xl border border-ink-100 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-ink-200 hover:shadow-lift">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[13px] font-bold tabular-nums text-ink-300">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset", o.cls)}>
                      <o.icon className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <h3 className="mt-4 text-[19px] font-bold">{f.step}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500">{f.text}</p>
                </div>
                {i < flow.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 -right-3 hidden h-px w-4 bg-ink-200 lg:block [.group:nth-child(5n)_&]:hidden"
                  />
                )}
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
