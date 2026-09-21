import { ArrowRight, Award, BadgeCheck, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProfileCard } from "./ProfileCard";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(14_164_122/0.14),transparent)]" />
      <div className="pointer-events-none absolute top-24 right-[-120px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgb(232_180_76/0.18),transparent)]" />

      <div className="container-x relative grid items-center gap-14 pt-14 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-20 lg:pb-28">
        <div className="max-w-2xl animate-fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white/80 py-1.5 pr-4 pl-1.5 text-[13px] font-medium text-ink-600 shadow-soft">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-500 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
              <Sparkles className="h-3 w-3" /> New
            </span>
            Academy-certified talent, now on one platform
          </div>

          <h1 className="mt-6 text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-[3.6rem] lg:text-[4.2rem]">
            Hire verified virtual assistants,{" "}
            <span className="font-serif font-normal italic tracking-normal text-brand-600">not résumés.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-500 sm:text-[19px]">
            Hirewise Connect is the agency-controlled talent marketplace from Hirewise Virtual Assistance Services.
            Every candidate is trained, assessed, and certified by Hirewise. You evaluate real evidence. We handle
            pricing, interviews, contracts, deposits, and deployment.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button href="/register?as=client" size="lg">
              Browse verified talent <ArrowRight className="h-4 w-4" />
            </Button>
            <Button href="/register?as=talent" variant="outline" size="lg">
              Join as talent
            </Button>
          </div>

          <ul className="mt-9 grid gap-3 text-[13.5px] text-ink-600 sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" /> Hirewise-verified profiles only
            </li>
            <li className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0 text-brand-600" /> One price, set by Hirewise
            </li>
            <li className="flex items-center gap-2">
              <Award className="h-4 w-4 shrink-0 text-brand-600" /> Certified through the VA Academy
            </li>
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none">
          <div className="relative flex justify-center lg:justify-end">
            <ProfileCard className="animate-fade-up [animation-delay:150ms]" />

            <div className="absolute -top-6 left-2 hidden animate-float rounded-2xl border border-ink-100 bg-white px-3.5 py-2.5 shadow-lift sm:block lg:-left-8">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Certification</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                <Award className="h-4 w-4 text-gold-600" /> Cold Calling · Coach L. Reyes
              </p>
            </div>

            <div className="absolute -bottom-7 right-4 hidden animate-float [animation-delay:1.2s] rounded-2xl border border-ink-100 bg-white px-3.5 py-2.5 shadow-lift sm:block lg:-right-6">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Interview request</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                <span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse-soft" /> Sales coordinating · Thu 9:00 PST
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
