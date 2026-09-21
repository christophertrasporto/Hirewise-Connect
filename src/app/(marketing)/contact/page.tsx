import type { Metadata } from "next";
import { Mail, Building2, GraduationCap, Clock3 } from "lucide-react";
import { PageHero } from "@/components/marketing/PageHero";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Contact", description: "Talk to the Hirewise team." };

const inputCls =
  "h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-[15px] placeholder:text-ink-300 hover:border-ink-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none";

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Tell us what you need. <span className="font-serif font-normal italic text-brand-600">We will take it from there.</span>
          </>
        }
        description="Hiring requirements, Academy questions, or partnership enquiries. A Hirewise team member will respond directly."
      />
      <section className="py-24">
        <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            {[
              { icon: Building2, t: "Hiring enquiries", d: "Tell us the role, schedule, and start date. Sales will reply with next steps." },
              { icon: GraduationCap, t: "Academy and talent", d: "Questions about courses, certifications, or your profile review." },
              { icon: Clock3, t: "Response time", d: "Within one business day, Manila time." },
              { icon: Mail, t: "Email", d: site.email },
            ].map((c) => (
              <div key={c.t} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
                  <c.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[15px] font-bold text-ink-900">{c.t}</p>
                  <p className="mt-0.5 text-[14px] text-ink-500">{c.d}</p>
                </div>
              </div>
            ))}
          </div>

          <form className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft sm:p-8" action="#" method="post">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">Name</label>
                <input id="name" className={inputCls} placeholder="Your name" />
              </div>
              <div>
                <label htmlFor="company" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">Company</label>
                <input id="company" className={inputCls} placeholder="Company name" />
              </div>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">Work email</label>
                <input id="email" type="email" className={inputCls} placeholder="you@company.com" />
              </div>
              <div>
                <label htmlFor="topic" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">Topic</label>
                <select id="topic" className={inputCls} defaultValue="hiring">
                  <option value="hiring">I want to hire</option>
                  <option value="talent">I am talent</option>
                  <option value="academy">Academy</option>
                  <option value="other">Something else</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="message" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">Message</label>
                <textarea id="message" rows={5} className={`${inputCls} h-auto py-3`} placeholder="Role, number of agents, schedule, start date…" />
              </div>
            </div>
            <button type="button" className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-ink-900 text-[15px] font-semibold text-white hover:bg-ink-800 sm:w-auto sm:px-8">
              Send message
            </button>
            <p className="mt-3 text-[12.5px] text-ink-400">Demo build. Form delivery is connected in Phase 1.</p>
          </form>
        </div>
      </section>
    </>
  );
}
