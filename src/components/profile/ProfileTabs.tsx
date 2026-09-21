"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/profile", label: "Overview" },
  { href: "/profile/personal", label: "Personal" },
  { href: "/profile/professional", label: "Professional" },
  { href: "/profile/skills", label: "Skills" },
  { href: "/profile/experience", label: "Experience" },
  { href: "/profile/resume", label: "Résumé" },
  { href: "/profile/media", label: "Video & voice" },
];

export function ProfileTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-8 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Profile sections">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link key={t.href} href={t.href} className={cn("shrink-0 rounded-full px-4 py-2 text-[13.5px] font-semibold transition", active ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
