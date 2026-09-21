import { Plus } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";

const faqs = [
  {
    q: "Is Hirewise Connect a freelancer marketplace?",
    a: "No. Clients discover and evaluate talent on the platform, but Hirewise controls pricing, interview coordination, contracts, payment collection, and deployment. The official client relationship is always with Hirewise.",
  },
  {
    q: "Who sets the rate I see on a candidate profile?",
    a: "Hirewise administrators. Each candidate has one client billing rate, reviewed against experience, certifications, assessment results, and campaign history. Agents cannot change it, and it is separate from what Hirewise pays the agent.",
  },
  {
    q: "Can I contact a candidate directly?",
    a: "Not during the hiring process. Personal contact details are never shown. You request an interview through the platform and your Hirewise account manager schedules it. This protects both you and the candidate.",
  },
  {
    q: "What happens after I select a candidate?",
    a: "Hirewise confirms the commercial terms, issues the service agreement, and invoices the required deposit. Once the deposit is paid and the deployment checklist is complete, the agent starts on the agreed date.",
  },
  {
    q: "How are certifications verified?",
    a: "They are issued by the Hirewise VA Academy after course completion, assessment, and coach review where required. Certifications are added to profiles automatically and cannot be self-claimed.",
  },
  {
    q: "What do I need to agree to before using the platform?",
    a: "Clients accept the Terms of Service, Privacy Policy, Hiring Terms, Non-Circumvention Policy, and Communication Policy. Talent accepts the equivalent platform, representation, non-circumvention, and confidentiality terms. Every acceptance is versioned and recorded.",
  },
];

export function FAQ() {
  return (
    <section className="py-24 lg:py-32">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHeading
          eyebrow="Questions"
          title={
            <>
              Straight answers about <span className="font-serif font-normal italic text-brand-600">how it works.</span>
            </>
          }
          description="If it is not covered here, our team will walk you through it before you shortlist a single candidate."
        />
        <dl className="divide-y divide-ink-100 rounded-3xl border border-ink-100 bg-white px-2 shadow-soft">
          {faqs.map((f) => (
            <details key={f.q} className="group px-4 py-2 open:bg-ink-50/60 first:rounded-t-3xl last:rounded-b-3xl">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[16px] font-semibold text-ink-800 [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-200 text-ink-500 transition-transform duration-300 group-open:rotate-45 group-open:border-brand-300 group-open:text-brand-600">
                  <Plus className="h-4 w-4" />
                </span>
              </summary>
              <p className="pr-14 pb-5 text-[15px] leading-relaxed text-ink-500">{f.a}</p>
            </details>
          ))}
        </dl>
      </div>
    </section>
  );
}
