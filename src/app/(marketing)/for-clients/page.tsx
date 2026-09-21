import type { Metadata } from "next";
import { ArrowRight, Search, Bookmark, CalendarCheck, Lock, FileSignature, Rocket, LayoutDashboard, EyeOff, Scale } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { ControlSection } from "@/components/marketing/ControlSection";
import { FAQ } from "@/components/marketing/FAQ";
import { CTASection } from "@/components/marketing/CTASection";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "For clients",
  description: "Discover certified virtual assistants and let Hirewise handle pricing, interviews, contracts, and deployment.",
};

export default function ForClientsPage() {
  return (
    <>
      <PageHero
        eyebrow="For clients"
        title={
          <>
            Evaluate real evidence. <span className="font-serif font-normal italic text-brand-600">Let Hirewise handle the rest.</span>
          </>
        }
        description="Search Hirewise-verified talent by role, skill, certification, and assessment result. Shortlist, compare, and request interviews. Your account manager coordinates every step from interview to deployment."
        actions={
          <>
            <Button href="/register?as=client" size="lg">
              Create a client account <ArrowRight className="h-4 w-4" />
            </Button>
            <Button href="/how-it-works" variant="outline" size="lg">
              See the full flow
            </Button>
          </>
        }
      />
      <FeatureGrid
        eyebrow="What you get"
        title="A hiring workflow built around certainty"
        description="Every capability below exists to answer one question: can this person actually do the job, and will the engagement hold together?"
        features={[
          { icon: Search, title: "Evidence-based search", text: "Filter by role, skill, industry, certification, Academy course, assessment result, availability, timezone, work setup, language, software, campaign experience, verification level, and rate range." },
          { icon: Bookmark, title: "Shortlist and compare", text: "Save candidates, add private notes, and compare up to four side by side on skills, certifications, assessments, availability, and rate." },
          { icon: CalendarCheck, title: "Managed interviews", text: "Request interviews with preferred times. Hirewise Sales confirms with you and the candidate, schedules, and keeps the communication history." },
          { icon: Lock, title: "One published rate", text: "Each candidate's client rate is set and approved by Hirewise. No haggling, no rate conversations with agents, no surprises later." },
          { icon: FileSignature, title: "Agreement and deposit", text: "After selection, Hirewise issues the service agreement and deposit invoice. Deployment starts once the configurable deposit is settled." },
          { icon: Rocket, title: "Deployment, managed", text: "A deployment checklist covers equipment, accounts, schedule, and kickoff. Then Hirewise manages the agent for you." },
          { icon: LayoutDashboard, title: "A dashboard that matters", text: "Recommended candidates, recently viewed, shortlists, interview requests, upcoming interviews, active agents, contracts, invoices, and deposits in one place." },
          { icon: EyeOff, title: "Privacy on both sides", text: "You never see agent personal contact details, and agents never see yours. Your requirements and financial terms are visible only to you and Hirewise." },
          { icon: Scale, title: "Clear terms up front", text: "Hiring Terms, Non-Circumvention, and Communication policies are accepted once, versioned, and always available in your account." },
        ]}
      />
      <ControlSection />
      <FAQ />
      <CTASection />
    </>
  );
}
