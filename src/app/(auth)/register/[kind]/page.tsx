import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Construction } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Registration" };

const copy = {
  client: {
    title: "Client registration",
    fields: [
      "Company name, contact person, position",
      "Business email, phone, website, country, timezone",
      "Industry and services needed",
      "Number of agents, preferred schedule, expected start date",
      "Acceptance of Terms, Privacy, Hiring Terms, Non-Circumvention, and Communication policies",
    ],
  },
  talent: {
    title: "Talent registration",
    fields: [
      "Full name, professional name, email, phone, location, timezone",
      "Primary role, skills, years of experience, industry experience",
      "Résumé, availability, preferred schedule, work setup",
      "Equipment, internet, software experience, portfolio",
      "Acceptance of Platform Terms, Privacy, Representation, Non-Circumvention, Communication, and Confidentiality terms",
    ],
  },
} as const;

export default async function RegisterKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "client" && kind !== "talent") notFound();
  const c = copy[kind];

  return (
    <AuthShell>
      <div className="w-full max-w-[520px]">
        <Link
          href="/register"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" /> Choose a different account type
        </Link>
        <h1 className="mt-6 text-[2rem] font-bold leading-tight">{c.title}</h1>
        <p className="mt-2 text-[15px] text-ink-500">
          This multi-step form, with versioned agreement acceptance, is built in Phase 1. Here is what it collects.
        </p>
        <ol className="mt-6 space-y-3">
          {c.fields.map((f, i) => (
            <li key={f} className="flex gap-3 rounded-2xl border border-ink-100 bg-white p-4 text-[14.5px] text-ink-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[12px] font-bold text-white">
                {i + 1}
              </span>
              {f}
            </li>
          ))}
        </ol>
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-gold-200 bg-gold-50 px-3.5 py-3 text-[13.5px] text-gold-700">
          <Construction className="mt-0.5 h-4 w-4 shrink-0" />
          Demo build. Registration is not connected to a backend yet.
        </div>
      </div>
    </AuthShell>
  );
}
