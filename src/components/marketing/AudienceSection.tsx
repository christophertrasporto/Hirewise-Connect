import { ArrowRight, Building2, GraduationCap, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";

const clientPoints = [
  "Search by role, skill, certification, assessment result, timezone, and rate",
  "Watch approved video introductions and listen to real call samples",
  "Shortlist, annotate, and compare candidates side by side",
  "Request interviews; your Hirewise account manager coordinates everything",
  "One published rate per candidate. No negotiation, no surprises",
  "Deposit, agreement, and deployment handled in one tracked workflow",
];

const talentPoints = [
  "Train in the Hirewise VA Academy with courses built by working coaches",
  "Earn certifications that appear on your profile automatically",
  "Showcase video, voice samples, and coach-assessed scores",
  "Get discovered by vetted clients without exposing your personal contact details",
  "Interviews and placements coordinated by the Hirewise team",
  "A structured pathway from learning to a managed placement",
];

export function AudienceSection() {
  return (
    <section className="bg-ink-50/70 py-24 lg:py-32">
      <div className="container-x grid gap-6 lg:grid-cols-2">
        <Reveal>
          <article className="relative h-full overflow-hidden rounded-3xl border border-ink-100 bg-white p-8 shadow-soft sm:p-10">
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-100/70 blur-3xl" />
            <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="relative mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">For clients</p>
            <h3 className="relative mt-2 text-[28px] font-bold leading-tight">Hire with evidence. Deploy with confidence.</h3>
            <ul className="relative mt-6 space-y-3">
              {clientPoints.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-ink-600">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" /> {p}
                </li>
              ))}
            </ul>
            <div className="relative mt-8 flex flex-wrap gap-3">
              <Button href="/register?as=client">
                Create a client account <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/for-clients" variant="ghost">
                Learn more
              </Button>
            </div>
          </article>
        </Reveal>

        <Reveal delay={100}>
          <article className="relative h-full overflow-hidden rounded-3xl bg-ink-900 p-8 text-white shadow-lift sm:p-10">
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gold-500/20 blur-3xl" />
            <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-300 ring-1 ring-inset ring-gold-500/30">
              <GraduationCap className="h-6 w-6" />
            </span>
            <p className="relative mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold-300">For talent</p>
            <h3 className="relative mt-2 text-[28px] font-bold leading-tight text-white">Learn. Get certified. Get placed.</h3>
            <ul className="relative mt-6 space-y-3">
              {talentPoints.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-ink-200">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-gold-300" /> {p}
                </li>
              ))}
            </ul>
            <div className="relative mt-8 flex flex-wrap gap-3">
              <Button href="/register?as=talent" variant="white">
                Apply as talent <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/for-talent" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
                Learn more
              </Button>
            </div>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
