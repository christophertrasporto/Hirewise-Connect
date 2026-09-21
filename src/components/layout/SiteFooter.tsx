import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { footerNav, site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-100 bg-ink-50/60">
      <div className="container-x py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-ink-500">
              The agency-controlled talent marketplace of {site.company}. Hirewise trains, certifies, verifies,
              and showcases talent, then coordinates hiring and manages the client relationship end to end.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[12px] font-medium text-ink-500">
              <span className="rounded-full bg-white px-3 py-1 ring-1 ring-ink-200">Philippines-based talent</span>
              <span className="rounded-full bg-white px-3 py-1 ring-1 ring-ink-200">US · AU · UK · CA clients</span>
            </div>
          </div>
          {footerNav.map((group) => (
            <div key={group.heading}>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">{group.heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[14.5px] text-ink-600 transition-colors hover:text-ink-900">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-ink-200/70 pt-6 text-[13px] text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.company}. All rights reserved.
          </p>
          <p>
            Talent on Hirewise Connect is represented through Hirewise. Commercial arrangements go through Hirewise
            under the applicable agreements.
          </p>
        </div>
      </div>
    </footer>
  );
}
