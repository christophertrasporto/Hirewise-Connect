"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeThemeChoice, resolveTheme, themeCookie, type ThemeChoice } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Use my device setting", icon: Monitor },
];

function apply(choice: ThemeChoice) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(choice, prefersDark));
  root.setAttribute("data-theme-choice", choice);
}

/**
 * Theme switch for headers. The icon follows the page's resolved theme through CSS (no hydration mismatch); the menu
 * remembers the choice in a cookie, and "Use my device setting" follows the operating system, live.
 */
export function ThemeToggle({ className, align = "right" }: { className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChoice(normalizeThemeChoice(document.documentElement.getAttribute("data-theme-choice")));
  }, []);

  // Follow the operating system while the choice is "system".
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: ThemeChoice) {
    document.cookie = themeCookie(next);
    apply(next);
    setChoice(next);
    setOpen(false);
  }

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Change theme" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-600 transition hover:bg-ink-100">
        <Sun className="h-[18px] w-[18px] dark:hidden" aria-hidden="true" />
        <Moon className="hidden h-[18px] w-[18px] dark:block" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className={cn("absolute top-12 z-50 w-56 rounded-2xl border border-ink-100 bg-white p-1.5 shadow-lift", align === "right" ? "right-0" : "left-0")}>
          {OPTIONS.map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={choice === o.value} onClick={() => pick(o.value)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-ink-700 hover:bg-ink-50">
              <o.icon className="h-4 w-4 text-ink-500" aria-hidden="true" />
              <span className="flex-1">{o.label}</span>
              {choice === o.value && <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
