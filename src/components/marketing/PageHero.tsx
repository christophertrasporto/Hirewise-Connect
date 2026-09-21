import { Eyebrow } from "@/components/ui/Badge";
import type { ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-ink-100">
      <div className="pointer-events-none absolute inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(14_164_122/0.12),transparent)]" />
      <div className="container-x relative py-20 lg:py-28">
        <div className="max-w-3xl animate-fade-up">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-5 text-[2.5rem] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[3.4rem]">{title}</h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-500 sm:text-[19px]">{description}</p>
          {actions && <div className="mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div>}
        </div>
      </div>
    </section>
  );
}
