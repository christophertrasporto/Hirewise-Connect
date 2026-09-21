import { Hero } from "@/components/marketing/Hero";
import { StatsBar } from "@/components/marketing/StatsBar";
import { FlowSection } from "@/components/marketing/FlowSection";
import { EvidenceSection } from "@/components/marketing/EvidenceSection";
import { ControlSection } from "@/components/marketing/ControlSection";
import { LadderSection } from "@/components/marketing/LadderSection";
import { AudienceSection } from "@/components/marketing/AudienceSection";
import { AcademySection } from "@/components/marketing/AcademySection";
import { FAQ } from "@/components/marketing/FAQ";
import { CTASection } from "@/components/marketing/CTASection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatsBar />
      <FlowSection />
      <EvidenceSection />
      <ControlSection />
      <LadderSection />
      <AudienceSection />
      <AcademySection />
      <FAQ />
      <CTASection />
    </>
  );
}
