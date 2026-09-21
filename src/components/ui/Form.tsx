"use client";

import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

export const inputBase =
  "h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-4 disabled:bg-ink-50 disabled:text-ink-400";
export const inputOk = "border-ink-200 hover:border-ink-300 focus:border-brand-500 focus:ring-brand-100";
export const inputErr = "border-red-300 focus:border-red-400 focus:ring-red-100";

export function Field({ label, htmlFor, error, hint, trailing, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; trailing?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-[13.5px] font-semibold text-ink-800">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12.5px] font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ invalid, className, ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cn(inputBase, invalid ? inputErr : inputOk, className)} />;
}

export function Textarea({ invalid, className, ...props }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid || undefined} className={cn(inputBase, "h-auto min-h-[110px] py-2.5", invalid ? inputErr : inputOk, className)} />;
}

export function Select({ invalid, className, children, ...props }: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select {...props} aria-invalid={invalid || undefined} className={cn(inputBase, invalid ? inputErr : inputOk, className)}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-[14px] text-ink-700 select-none", className)}>
      <input type="checkbox" {...props} className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 accent-brand-600" />
      <span>{label}</span>
    </label>
  );
}

export function SubmitButton({ children, pendingText, variant = "dark", className, ...props }: ComponentProps<"button"> & { pendingText?: string; variant?: "dark" | "primary" | "outline" | "danger" }) {
  const { pending } = useFormStatus();
  const styles = {
    dark: "bg-ink-900 text-white hover:bg-ink-800 shadow-soft",
    primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-soft",
    outline: "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button type="submit" disabled={pending || props.disabled} {...props} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold transition disabled:opacity-60", styles, className)}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const map = {
    error: { cls: "border-red-200 bg-red-50 text-red-700", Icon: AlertCircle },
    success: { cls: "border-brand-200 bg-brand-50 text-brand-700", Icon: CheckCircle2 },
    info: { cls: "border-gold-200 bg-gold-50 text-gold-700", Icon: Info },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed", map.cls)}>
      <map.Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** Development-only link box shown when DEV_EXPOSE_LINKS is on. */
export function DevLink({ url, label }: { url?: string; label: string }) {
  if (!url) return null;
  return (
    <FormAlert tone="info">
      <span className="font-semibold">Dev mode:</span> {label}{" "}
      <a href={url} className="font-semibold underline underline-offset-2">
        open link
      </a>
    </FormAlert>
  );
}
