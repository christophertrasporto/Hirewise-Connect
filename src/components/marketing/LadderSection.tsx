import { Check } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { verificationLadder } from "@/lib/site";
import { cn } from "@/lib/cn";

export function LadderSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="container-x">
        <SectionHeading
          align="center"
          eyebrow="Hirewise verification"
          title={
            <>
              Six levels. <span className="font-serif font-normal italic text-brand-600">Zero guesswork.</span>
            </>
          }
          description="Every profile carries a verification level defined by Hirewise. Requirements are configurable by administrators, recomputed automatically, and visible to clients as a single badge."
        />

        <ol className="relative mt-16 grid gap-6 md:grid-cols-3 lg:grid-cols-6">
          <span
            aria-hidden="true"
            className="absolute top-6 right-[8%] left-[8%] hidden h-px bg-gradient-to-r from-ink-200 via-brand-300 to-brand-500 lg:block"
          />
          {verificationLadder.map((v, i) => {
            const last = i === verificationLadder.length - 1;
            return (
              <Reveal as="li" key={v.level} delay={i * 70} className="relative text-center">
                <span
                  className={cn(
                    "relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full font-display text-[15px] font-bold ring-4 ring-white",
                    last ? "bg-brand-500 text-white shadow-glow" : "bg-ink-900 text-white",
                  )}
                >
                  {last ? <Check className="h-5 w-5" /> : i + 1}
                </span>
                <h3 className="mt-4 text-[15px] font-bold">{v.level}</h3>
                <p className="mx-auto mt-1.5 max-w-[190px] text-[13px] leading-relaxed text-ink-500">{v.detail}</p>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
