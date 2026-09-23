import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Eyebrow } from "@/components/ui/Badge";
import { prisma } from "@/server/db/client";
import { renderMarkdown } from "@/lib/markdown";

/** Public slug → the agreement type whose active version is shown. Versions are published under Staff → Agreements. */
const AGREEMENT_BY_SLUG: Record<string, "CLIENT_TOS" | "CLIENT_PRIVACY" | "CLIENT_HIRING_TERMS" | "CLIENT_NON_CIRCUMVENTION" | "CLIENT_COMMUNICATION"> = {
  terms: "CLIENT_TOS",
  privacy: "CLIENT_PRIVACY",
  "hiring-terms": "CLIENT_HIRING_TERMS",
  "non-circumvention": "CLIENT_NON_CIRCUMVENTION",
  "communication-policy": "CLIENT_COMMUNICATION",
};

export const dynamic = "force-dynamic";

// LEGAL_PLACEHOLDER: these outlines describe what each agreement must cover.
// Replace with counsel-approved text before launch. Versions are stored in the Agreement table (Phase 1).
const docs: Record<string, { title: string; audience: string; sections: string[] }> = {
  terms: {
    title: "Terms of Service",
    audience: "Clients and talent",
    sections: ["Definitions", "Account eligibility and registration", "Platform use and prohibited conduct", "Intellectual property", "Suspension and termination", "Limitation of liability", "Governing law and disputes"],
  },
  privacy: {
    title: "Privacy Policy",
    audience: "Clients and talent",
    sections: ["Data we collect", "How we use data", "Media recordings and profile content", "Sharing with clients and talent", "Retention and deletion", "Your rights (PH Data Privacy Act, GDPR where applicable)", "Contact"],
  },
  "hiring-terms": {
    title: "Hiring Terms",
    audience: "Clients",
    sections: ["Representation of talent through Hirewise", "Client billing rates and rate changes", "Interview process", "Selection, service agreement, and deposit", "Deployment and management", "Replacement and pausing", "Invoicing and payment terms"],
  },
  "non-circumvention": {
    title: "Non-Circumvention / Direct Hiring Policy",
    audience: "Clients and talent",
    sections: ["Introductions made through Hirewise Connect", "Restriction on direct engagement", "Duration of restriction", "Placement fee on breach", "Reporting and incident handling", "Exceptions and written consent"],
  },
  "communication-policy": {
    title: "Communication Policy",
    audience: "Clients and talent",
    sections: ["Communication through Hirewise during hiring", "Interview coordination", "Prohibited topics (rates, compensation, direct contracting)", "Contact information", "After deployment", "Violations"],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = docs[slug];
  return { title: d ? d.title : "Policy" };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = docs[slug];
  if (!d) notFound();
  const type = AGREEMENT_BY_SLUG[slug];
  const active = type ? await prisma.agreement.findFirst({ where: { type, isActive: true }, orderBy: { version: "desc" } }).catch(() => null) : null;
  const placeholder = !active || active.bodyMarkdown.includes("LEGAL_PLACEHOLDER");

  if (active && !placeholder) {
    return (
      <section className="container-x py-20 lg:py-28">
        <div className="mx-auto max-w-3xl">
          <Eyebrow>Policies · {d.audience}</Eyebrow>
          <h1 className="mt-4 text-[2.4rem] font-extrabold leading-tight">{active.title}</h1>
          <p className="mt-3 text-[14px] text-ink-400">Version {active.version} · Effective {active.effectiveFrom.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
          <div className="mt-8 space-y-4">{renderMarkdown(active.bodyMarkdown)}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="container-x py-20 lg:py-28">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Policies · {d.audience}</Eyebrow>
        <h1 className="mt-4 text-[2.4rem] font-extrabold leading-tight">{d.title}</h1>
        <p className="mt-3 text-[14px] text-ink-400">Version 0.1 · Draft outline · Effective date to be set</p>

        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-gold-200 bg-gold-50 p-4 text-[14px] leading-relaxed text-gold-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Placeholder.</strong> This outline lists what the agreement must cover. It is not legal text. Replace with
            counsel-approved wording before launch. Every accepted version is recorded with user, timestamp, IP, and
            device information.
          </p>
        </div>

        <ol className="mt-10 space-y-6">
          {d.sections.map((s, i) => (
            <li key={s} className="border-b border-ink-100 pb-6">
              <h2 className="text-[19px] font-bold">
                {i + 1}. {s}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-400">LEGAL_PLACEHOLDER — section text to be supplied.</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
