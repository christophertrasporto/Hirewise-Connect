import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { CTASection } from "@/components/marketing/CTASection";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "About",
  description: "Hirewise Virtual Assistance Services operates a VA agency and call center, and built Hirewise Connect to run a controlled talent ecosystem.",
};

const principles = [
  { t: "Hirewise trains talent", d: "Through the VA Academy, with courses owned by working coaches." },
  { t: "Hirewise certifies talent", d: "Structured assessments and certification rules, not self-claims." },
  { t: "Hirewise verifies talent", d: "A configurable six-level verification ladder on every profile." },
  { t: "Hirewise showcases talent", d: "Approved videos, voice samples, and evidence-rich profiles." },
  { t: "Hirewise sources clients", d: "Vetted businesses that accept our hiring and communication terms." },
  { t: "Hirewise controls pricing", d: "One published client rate per candidate, separate from compensation." },
  { t: "Hirewise coordinates hiring", d: "Sales runs every interview and selection workflow." },
  { t: "Hirewise collects payment", d: "Deposit before deployment, with a full payment record." },
  { t: "Hirewise manages the relationship", d: "The official client relationship is always with Hirewise." },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Hirewise"
        title={
          <>
            An agency first. <span className="font-serif font-normal italic text-brand-600">A platform because of it.</span>
          </>
        }
        description="Hirewise Virtual Assistance Services runs a virtual assistance agency and call center. Hirewise Connect exists because clients needed better evidence, agents needed a structured pathway, and the agency needed to stay in control of pricing and relationships."
        actions={
          <Button href="/contact" variant="dark" size="lg">
            Talk to our team <ArrowRight className="h-4 w-4" />
          </Button>
        }
      />
      <section className="py-24 lg:py-32">
        <div className="container-x">
          <SectionHeading eyebrow="What we stand for" title="Nine things Hirewise does, so you do not have to" />
          <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {principles.map((p, i) => (
              <Reveal as="li" key={p.t} delay={(i % 3) * 70}>
                <div className="h-full rounded-3xl border border-ink-100 bg-white p-7">
                  <span className="font-display text-[13px] font-bold text-brand-600">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-3 text-[19px] font-bold">{p.t}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-ink-500">{p.d}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
      <CTASection />
    </>
  );
}
