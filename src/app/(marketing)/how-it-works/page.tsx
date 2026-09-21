import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { FlowSection } from "@/components/marketing/FlowSection";
import { LadderSection } from "@/components/marketing/LadderSection";
import { ControlSection } from "@/components/marketing/ControlSection";
import { CTASection } from "@/components/marketing/CTASection";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "How it works",
  description: "The Hirewise Connect process from client registration to active placement.",
};

const clientFlow = [
  "Client profile created",
  "Requirements gathered",
  "Browse and search talent",
  "Shortlist candidates",
  "Request interview",
  "Hirewise Sales notified",
  "Sales reviews requirement",
  "Interview scheduled",
  "Candidate interview",
  "Candidate selection",
  "Commercial terms confirmed",
  "Service agreement",
  "Deposit payment",
  "Deployment preparation",
  "Agent starts work",
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title={
          <>
            Every step tracked. <span className="font-serif font-normal italic text-brand-600">Hirewise in the middle.</span>
          </>
        }
        description="From the first search to the first day of work, each stage has an owner, a status, and a record. Here is the whole path."
        actions={
          <Button href="/register?as=client" size="lg">
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
        }
      />
      <FlowSection />
      <section className="bg-ink-50/70 py-24 lg:py-32">
        <div className="container-x">
          <SectionHeading eyebrow="Client onboarding" title="Fifteen stages from registration to a working agent" description="This is the operational sequence your Hirewise account manager follows with you." />
          <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clientFlow.map((s, i) => (
              <Reveal as="li" key={s} delay={(i % 3) * 60}>
                <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-[12px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-[14.5px] font-semibold text-ink-800">{s}</span>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
      <LadderSection />
      <ControlSection />
      <CTASection />
    </>
  );
}
