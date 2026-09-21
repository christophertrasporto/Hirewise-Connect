import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function CTASection() {
  return (
    <section className="pb-24 lg:pb-32">
      <div className="container-x">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink-900 px-6 py-16 text-center text-white shadow-lift sm:px-12 lg:py-24">
          <div className="pointer-events-none absolute inset-0 grid-bg-dark [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
          <div className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(14_164_122/0.35),transparent)]" />
          <div className="relative mx-auto max-w-2xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-brand-300">Get started</p>
            <h2 className="mt-4 text-[2.2rem] font-bold leading-[1.05] text-white sm:text-[3rem]">
              Hirewise trains, certifies, verifies, and deploys.{" "}
              <span className="font-serif font-normal italic text-brand-300">You just choose.</span>
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-300">
              Create a client account to browse verified talent, or apply as talent to start your pathway through the
              Hirewise VA Academy.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button href="/register?as=client" size="lg">
                Hire verified talent <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/register?as=talent" variant="white" size="lg">
                Join as talent
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
