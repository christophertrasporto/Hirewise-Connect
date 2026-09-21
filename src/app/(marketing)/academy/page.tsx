import type { Metadata } from "next";
import { ArrowRight, PhoneCall, CalendarClock, BadgeDollarSign, Headset, Laptop, Database, Target, MessageSquare, Users, Layers } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { CTASection } from "@/components/marketing/CTASection";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "VA Academy",
  description: "Courses built by Hirewise coaches. Certifications that flow straight into your Connect profile.",
};

const catalog = [
  { icon: PhoneCall, name: "Cold Calling", level: "Certification", desc: "Openers, objection handling, tonality, and live mock-call assessment." },
  { icon: CalendarClock, name: "Appointment Setting", level: "Certification", desc: "Qualification frameworks, calendar discipline, and confirmation workflows." },
  { icon: BadgeDollarSign, name: "Sales", level: "Certification", desc: "Discovery, pitch structure, closing, and CRM hygiene for remote sales roles." },
  { icon: Headset, name: "Customer Service", level: "Certification", desc: "Tone, de-escalation, ticket handling, and quality scoring." },
  { icon: Laptop, name: "Virtual Assistance", level: "Course", desc: "Inbox, calendar, research, and documentation for executive support." },
  { icon: Database, name: "CRM", level: "Course", desc: "Pipeline management across common CRMs, data quality, and reporting." },
  { icon: Target, name: "Lead Generation", level: "Course", desc: "List building, enrichment, outreach sequencing, and compliance basics." },
  { icon: MessageSquare, name: "Communication", level: "Course", desc: "Written and spoken business communication for international clients." },
  { icon: Users, name: "Leadership", level: "Course", desc: "Team lead fundamentals for agents stepping into supervisory roles." },
  { icon: Layers, name: "Campaign-Specific Training", level: "Custom", desc: "Built for a client campaign. Certification scoped to that campaign." },
];

const assessment = [
  { label: "Exam score", desc: "Knowledge check with a course passing score." },
  { label: "Practical score", desc: "Task-based evaluation of real work output." },
  { label: "Roleplay score", desc: "Live mock call or scenario with a coach." },
  { label: "Communication score", desc: "Clarity, tone, and professionalism." },
  { label: "Skill assessment", desc: "Per-skill scoring that can verify profile skills." },
  { label: "Result label", desc: "Not Yet Qualified · Developing · Qualified · Advanced · Expert" },
];

export default function AcademyPage() {
  return (
    <>
      <PageHero
        eyebrow="Hirewise VA Academy"
        title={
          <>
            Courses by coaches. <span className="font-serif font-normal italic text-brand-600">Certifications that count.</span>
          </>
        }
        description="The Academy is where Hirewise talent is trained and assessed. Each course has a coach, a passing score, and a certification rule. When you pass, the certification is added to your Connect profile automatically."
        actions={
          <>
            <Button href="/register?as=talent" size="lg">
              Start your pathway <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <section className="py-24 lg:py-32">
        <div className="container-x">
          <SectionHeading eyebrow="Catalog" title="Current course areas" description="Coaches build and own their courses. Hirewise administrators define which courses lead to certification." />
          <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((c, i) => (
              <Reveal as="li" key={c.name} delay={(i % 3) * 70}>
                <div className="flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">
                  <div className="flex items-start justify-between">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-900 text-white">
                      <c.icon className="h-5 w-5" />
                    </span>
                    <Badge tone={c.level === "Certification" ? "gold" : c.level === "Custom" ? "ink" : "outline"}>{c.level}</Badge>
                  </div>
                  <h3 className="mt-5 text-[18px] font-bold">{c.name}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-500">{c.desc}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-ink-50/70 py-24 lg:py-32">
        <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="Coach assessment"
            title="Structured scores, not star ratings"
            description="Coaches record scores across several dimensions plus written strengths and areas for improvement. The result label is configurable by Hirewise and shown to clients."
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {assessment.map((a, i) => (
              <Reveal as="li" key={a.label} delay={(i % 2) * 70}>
                <div className="h-full rounded-2xl border border-ink-100 bg-white p-5">
                  <p className="text-[15px] font-bold text-ink-900">{a.label}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">{a.desc}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <CTASection />
    </>
  );
}
