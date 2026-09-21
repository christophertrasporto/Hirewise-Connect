import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, GraduationCap, Check } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a client or talent account on Hirewise Connect.",
};

const options = [
  {
    key: "client",
    icon: Building2,
    title: "I want to hire",
    subtitle: "Client account",
    points: ["Browse verified, certified talent", "Shortlist and request interviews", "Hirewise manages pricing and deployment"],
    accent: "brand",
  },
  {
    key: "talent",
    icon: GraduationCap,
    title: "I want to be hired",
    subtitle: "Talent account",
    points: ["Train and certify in the VA Academy", "Showcase video, voice, and assessments", "Get placed through Hirewise"],
    accent: "gold",
  },
] as const;

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const preselected = as === "client" || as === "talent" ? as : null;

  return (
    <AuthShell>
      <div className="w-full max-w-[560px]">
        <div className="mb-8">
          <h1 className="text-[2rem] font-bold leading-tight">Create your account</h1>
          <p className="mt-2 text-[15px] text-ink-500">
            Choose how you will use Hirewise Connect. You will review and accept the applicable agreements before your
            account is activated.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {options.map((o) => {
            const active = preselected === o.key;
            return (
              <Link
                key={o.key}
                href={`/register/${o.key}`}
                className={cn(
                  "group relative flex flex-col rounded-3xl border bg-white p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift",
                  active ? "border-brand-400 shadow-glow" : "border-ink-200 hover:border-ink-300",
                )}
              >
                {active && (
                  <span className="absolute top-4 right-4 rounded-full bg-brand-500 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white">
                    Selected
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset",
                    o.accent === "brand" ? "bg-brand-50 text-brand-600 ring-brand-200" : "bg-gold-50 text-gold-600 ring-gold-200",
                  )}
                >
                  <o.icon className="h-5 w-5" />
                </span>
                <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{o.subtitle}</p>
                <h2 className="mt-1 text-[20px] font-bold">{o.title}</h2>
                <ul className="mt-4 flex-1 space-y-2">
                  {o.points.map((p) => (
                    <li key={p} className="flex gap-2 text-[13.5px] leading-snug text-ink-600">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" /> {p}
                    </li>
                  ))}
                </ul>
                <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
                  Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <p className="mt-8 text-center text-[14px] text-ink-500">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
