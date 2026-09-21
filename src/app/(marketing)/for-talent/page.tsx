import type { Metadata } from "next";
import { ArrowRight, GraduationCap, Video, Mic2, Award, ShieldCheck, EyeOff, CalendarCheck, Briefcase, TrendingUp } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { LadderSection } from "@/components/marketing/LadderSection";
import { AcademySection } from "@/components/marketing/AcademySection";
import { CTASection } from "@/components/marketing/CTASection";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "For talent",
  description: "A structured pathway from Hirewise VA Academy training to a managed client placement.",
};

const journey = [
  "Profile incomplete",
  "Personal information",
  "Professional information",
  "Upload résumé",
  "Record video",
  "Voice sample",
  "Skills and experience",
  "Submit for review",
  "Hirewise review",
  "Approved and visible to clients",
];

export default function ForTalentPage() {
  return (
    <>
      <PageHero
        eyebrow="For talent"
        title={
          <>
            Your pathway from learning <span className="font-serif font-normal italic text-brand-600">to placement.</span>
          </>
        }
        description="Train in the Hirewise VA Academy, get assessed by real coaches, and let your certifications, video, and voice samples speak for you. Hirewise represents you to vetted clients and coordinates every interview."
        actions={
          <>
            <Button href="/register?as=talent" size="lg">
              Apply as talent <ArrowRight className="h-4 w-4" />
            </Button>
            <Button href="/academy" variant="outline" size="lg">
              Browse Academy courses
            </Button>
          </>
        }
      />

      <section className="py-24 lg:py-32">
        <div className="container-x">
          <SectionHeading
            eyebrow="Profile journey"
            title="Ten steps to an approved profile"
            description="Your dashboard shows completion percentage and the next step. Only approved profiles are visible to clients."
          />
          <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {journey.map((j, i) => (
              <Reveal as="li" key={j} delay={i * 50}>
                <div className="flex h-full items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 font-display text-[12px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-[14px] font-semibold text-ink-800">{j}</span>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <FeatureGrid
        eyebrow="What your profile shows"
        title="Show clients what you can do, not just what you say"
        features={[
          { icon: GraduationCap, title: "Academy certifications", text: "Complete eligible courses and your certification appears on your profile automatically." },
          { icon: Award, title: "Coach-assessed scores", text: "Structured exam, practical, roleplay, and communication scores replace vague star ratings." },
          { icon: Video, title: "Video introduction", text: "Upload a short introduction. Hirewise reviews it and gives feedback before clients see it." },
          { icon: Mic2, title: "Voice and call samples", text: "Cold calling, customer service, sales, and campaign samples, each reviewed and approved." },
          { icon: ShieldCheck, title: "Verification level", text: "Progress from Profile Submitted to Deployment Ready as you meet Hirewise requirements." },
          { icon: EyeOff, title: "Your privacy protected", text: "Clients never see your phone, personal email, or home address. Hirewise handles the contact." },
          { icon: CalendarCheck, title: "Interviews coordinated", text: "When a client requests an interview, Hirewise confirms the time with you and shares the link." },
          { icon: Briefcase, title: "Placement status", text: "Track selection, agreement, deposit, and start date from your dashboard." },
          { icon: TrendingUp, title: "A real career ladder", text: "Certifications and assessments influence how Hirewise positions you to clients." },
        ]}
      />
      <LadderSection />
      <AcademySection />
      <CTASection />
    </>
  );
}
