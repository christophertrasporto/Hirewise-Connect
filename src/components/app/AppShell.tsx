"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, X, LogOut, Bell } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";

export type NavItem = { href: string; label: string; icon: ReactNode };

export function AppShell({ nav, email, roleLabel, unread, onLogout, children }: { nav: NavItem[]; email: string; roleLabel: string; unread: number; onLogout: () => Promise<void>; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-col gap-1" aria-label="Application">
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition", active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900")}>
            <span className={cn("[&>svg]:h-4 [&>svg]:w-4", active ? "text-brand-300" : "text-ink-400")}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-ink-50/60">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-ink-100 bg-white p-5 lg:flex">
        <Logo />
        <div className="mt-8 flex-1">{links}</div>
        <div className="rounded-2xl bg-ink-50 p-3.5">
          <p className="truncate text-[13px] font-semibold text-ink-800">{email}</p>
          <p className="text-[12px] text-ink-400">{roleLabel}</p>
          <form action={onLogout} className="mt-3">
            <button type="submit" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 hover:text-ink-900">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-ink-100 bg-white/80 px-4 backdrop-blur sm:px-6 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink-100">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Logo />
          </div>
          <Link href="/notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-600 hover:bg-ink-100" aria-label={`Notifications, ${unread} unread`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        </header>
        {open && (
          <div className="border-b border-ink-100 bg-white p-4 lg:hidden">
            {links}
            <form action={onLogout} className="mt-3 px-3.5">
              <button type="submit" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600">
                <LogOut className="h-3.5 w-3.5" /> Sign out ({email})
              </button>
            </form>
          </div>
        )}
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
