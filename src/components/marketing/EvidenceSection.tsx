import { Award, BarChart3, Video, Mic2, ClipboardCheck, ShieldCheck, Briefcase, PhoneCall } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";
import { ArrowRight } from "lucide-react";

const evidence = [
  {
    icon: Award,
    title: "Hirewise certifications",
    text: "Issued only by the VA Academy or authorised Hirewise staff. Agents cannot self-claim.",
    accent: "text-gold-600 bg-gold-50",
  },
  {
    icon: BarChart3,
    title: "Structured assessment scores",
    text: "Exam, practical, roleplay, and communication scores. Labels from Developing to Expert.",
    accent: "text-brand-600 bg-brand-50",
  },
  {
    icon: Video,
    title: "Approved video introduction",
    text: "Reviewed by Hirewise before a client ever sees it.",
    accent: "text-ink-700 bg-ink-100",
  },
  {
    icon: Mic2,
    title: "Voice and call samples",
    text: "Introduction, cold calling, customer service, and sales samples, each individually approved.",
    accent: "text-brand-600 bg-brand-50",
  },
  {
    icon: ClipboardCheck,
    title: "Coach evaluation",
    text: "Written strengths, areas for improvement, and a certification recommendation from the coach.",
    accent: "text-gold-600 bg-gold-50",
  },
  {
    icon: Briefcase,
    title: "Verified experience",
    text: "Roles, industries, campaigns, and software, checked during profile review.",
    accent: "text-ink-700 bg-ink-100",
  },
  {
    icon: PhoneCall,
    title: "Campaign history",
    text: "What campaigns the agent has actually worked, not just what they say they can do.",
    accent: "text-brand-600 bg-brand-50",
  },
  {
    icon: ShieldCheck,
    title: "Hirewise verification status",
    text: "A six-level ladder from Profile Submitted to Deployment Ready, defined by Hirewise.",
    accent: "text-ink-700 bg-ink-100",
  },
];

export function EvidenceSection() {
  return (
    <section className="bg-ink-50/70 py-24 lg:py-32">
      <div className="container-x">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              eyebrow="Evidence, not claims"
              title={
                <>
                  A profile should prove it, <span className="font-serif font-normal italic text-brand-600">not just say it.</span>
                </>
              }
              description={
                <>
                  A candidate should not simply say “I am a cold caller.” On Hirewise Connect the profile shows the
                  certification, the assessment score, the recorded call, the coach’s evaluation, and the verification
                  status behind that claim.
                </>
              }
            />
            <div className="mt-8">
              <Button href="/for-clients" variant="dark">
                See what clients get <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2">
            {evidence.map((e, i) => (
              <Reveal as="li" key={e.title} delay={(i % 2) * 80}>
                <div className="h-full rounded-2xl border border-ink-100 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${e.accent}`}>
                    <e.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-[16.5px] font-bold">{e.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">{e.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
