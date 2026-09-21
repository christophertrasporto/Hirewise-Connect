import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarCheck, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import type { ReactNode } from "react";

const points = [
  { icon: BadgeCheck, text: "Every profile is Hirewise-verified before a client sees it." },
  { icon: ShieldCheck, text: "Pricing, contracts, and deposits are handled by Hirewise." },
  { icon: CalendarCheck, text: "Interviews are coordinated by your Hirewise account manager." },
];

export function AuthShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 grid-bg-dark [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(14_164_122/0.28),transparent)]" />
        <div className="pointer-events-none absolute -top-40 right-[-140px] h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgb(232_180_76/0.16),transparent)]" />

        <div className="relative">
          <Logo inverted />
        </div>

        <div className="relative max-w-md">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-brand-300">Hirewise Connect</p>
          <h2 className="mt-4 text-[2.6rem] font-bold leading-[1.05] text-white">
            One login for clients, talent, and the Hirewise team.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-300">
            We route you to the right workspace: the talent marketplace, your candidate profile, or the Hirewise
            operations console.
          </p>
          <ul className="mt-8 space-y-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-[15px] text-ink-200">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-400/30">
                  <p.icon className="h-4 w-4" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
          {aside}
        </div>

        <p className="relative text-[13px] text-ink-400">
          Talent on Hirewise Connect is represented through Hirewise. See our{" "}
          <Link href="/legal/non-circumvention" className="text-ink-200 underline-offset-4 hover:underline">
            Non-Circumvention Policy
          </Link>
          .
        </p>
      </aside>

      <div className="relative flex flex-col">
        <div className="container-x flex h-[72px] items-center justify-between lg:hidden">
          <Logo />
        </div>
        <div className="absolute top-6 right-6 hidden lg:block">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 transition-colors hover:text-ink-900"
          >
            <ArrowLeft className="h-4 w-4" /> Back to site
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">{children}</div>
      </div>
    </div>
  );
}
