import { Lock, EyeOff, Wallet, CalendarCheck } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

const pillars = [
  {
    icon: Lock,
    title: "Hirewise sets the price",
    problem: "Agents setting their own client rates. Clients negotiating salary directly.",
    solution:
      "Every candidate has one client rate, approved and published by Hirewise admins, with a full change history. Agents cannot edit it and internal compensation is a separate, restricted record.",
  },
  {
    icon: EyeOff,
    title: "Contact details stay private",
    problem: "Clients and agents taking the relationship off-platform after an introduction.",
    solution:
      "No personal phone numbers or emails on either side during discovery. Interview coordination flows through Hirewise Sales, and every introduction is logged.",
  },
  {
    icon: CalendarCheck,
    title: "Interviews run through Sales",
    problem: "Ad-hoc interviews with no record, no requirement, no follow-through.",
    solution:
      "Interview requests notify your account manager, create a follow-up task, and move through a tracked workflow from Requested to Scheduled to Client Decision.",
  },
  {
    icon: Wallet,
    title: "Deposit before deployment",
    problem: "Agents starting work before commercial terms are settled.",
    solution:
      "A placement cannot go active until the agreement is accepted and the configurable deposit is paid, unless an authorised manager records an override with a reason.",
  },
];

export function ControlSection() {
  return (
    <section className="relative overflow-hidden bg-ink-900 py-24 text-white lg:py-32">
      <div className="pointer-events-none absolute inset-0 grid-bg-dark [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
      <div className="pointer-events-none absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(14_164_122/0.25),transparent)]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(232_180_76/0.14),transparent)]" />

      <div className="container-x relative">
        <SectionHeading
          tone="dark"
          eyebrow="Built for control, not chaos"
          title={
            <>
              Not a freelancer marketplace. <span className="font-serif font-normal italic text-brand-300">An agency, with a platform.</span>
            </>
          }
          description="Freelancer sites let anyone negotiate with anyone. Hirewise Connect is designed around the problems agencies actually face, with safeguards that live in the system, not in a policy PDF."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {pillars.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <article className="group h-full rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition-colors hover:border-brand-400/40 hover:bg-white/[0.06]">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-400/30">
                  <p.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-[21px] font-bold text-white">{p.title}</h3>
                <dl className="mt-4 space-y-3 text-[14.5px] leading-relaxed">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">The problem</dt>
                    <dd className="mt-1 text-ink-300">{p.problem}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300">How Connect handles it</dt>
                    <dd className="mt-1 text-ink-100">{p.solution}</dd>
                  </div>
                </dl>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
