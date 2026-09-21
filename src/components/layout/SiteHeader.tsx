"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { nav } from "@/lib/site";
import { cn } from "@/lib/cn";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled ? "glass border-b border-ink-100 shadow-[0_1px_0_rgb(10_22_40/0.02)]" : "bg-transparent",
      )}
    >
      <div className="container-x flex h-[72px] items-center justify-between">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors",
                  active ? "text-ink-900" : "text-ink-500 hover:text-ink-900",
                )}
              >
                {item.label}
                {active && <span className="absolute inset-x-3.5 -bottom-0.5 h-0.5 rounded-full bg-brand-500" />}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button href="/login" variant="ghost" size="sm">
            Log in
          </Button>
          <Button href="/register?as=client" size="sm">
            Hire talent <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-800 hover:bg-ink-100 lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div
        id="mobile-nav"
        className={cn(
          "fixed inset-x-0 top-[72px] bottom-0 z-40 overflow-y-auto bg-white transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="container-x flex flex-col gap-1 py-6">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl px-4 py-3.5 text-lg font-medium text-ink-800 hover:bg-ink-50"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-6 flex flex-col gap-3">
            <Button href="/register?as=client" size="lg">
              Hire talent <ArrowRight className="h-4 w-4" />
            </Button>
            <Button href="/register?as=talent" variant="outline" size="lg">
              Join as talent
            </Button>
            <Button href="/login" variant="ghost" size="lg">
              Log in
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
