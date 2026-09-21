import type { LucideIcon } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { ReactNode } from "react";

export type Feature = { icon: LucideIcon; title: string; text: string };

export function FeatureGrid({
  eyebrow,
  title,
  description,
  features,
  columns = 3,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  features: Feature[];
  columns?: 2 | 3;
}) {
  return (
    <section className="py-24 lg:py-32">
      <div className="container-x">
        <SectionHeading eyebrow={eyebrow} title={title} description={description} />
        <ul className={`mt-14 grid gap-5 sm:grid-cols-2 ${columns === 3 ? "lg:grid-cols-3" : ""}`}>
          {features.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % columns) * 80}>
              <div className="h-full rounded-3xl border border-ink-100 bg-white p-7 transition-all duration-300 hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-lift">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-[18px] font-bold">{f.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-500">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
