"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/cn";

type Errors = { email?: string; password?: string };

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "magic">("password");

  function validate(): Errors {
    const next: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (mode === "password" && password.length < 8) next.password = "Password must be at least 8 characters.";
    return next;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    // Authentication backend ships in Phase 1 (see MASTER_PROMPT.md, Section 13).
    await new Promise((r) => setTimeout(r, 700));
    setPending(false);
    setNotice(
      mode === "password"
        ? "Demo build: sign-in is not connected yet. Authentication and role-based routing arrive in Phase 1."
        : "Demo build: magic links are not connected yet. Email delivery arrives in Phase 1.",
    );
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-8">
        <h1 className="text-[2rem] font-bold leading-tight">Welcome back</h1>
        <p className="mt-2 text-[15px] text-ink-500">Sign in to your Hirewise Connect account.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 rounded-full bg-ink-100 p-1 text-[13.5px] font-semibold" role="tablist">
        {(["password", "magic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setErrors({});
              setNotice(null);
            }}
            className={cn(
              "h-9 rounded-full transition-all",
              mode === m ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {m === "password" ? "Password" : "Magic link"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <Field label="Work email" htmlFor="email" error={errors.email}>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              aria-invalid={!!errors.email}
              className={inputCls(!!errors.email, "pl-11")}
            />
          </div>
        </Field>

        {mode === "password" && (
          <Field
            label="Password"
            htmlFor="password"
            error={errors.password}
            trailing={
              <Link href="/forgot-password" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">
                Forgot password?
              </Link>
            }
          >
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                aria-invalid={!!errors.password}
                className={inputCls(!!errors.password, "pr-12 pl-11")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        )}

        {mode === "password" && (
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink-600 select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 accent-brand-600"
            />
            Keep me signed in on this device
          </label>
        )}

        {notice && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-gold-200 bg-gold-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-gold-700"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink-900 text-[15px] font-semibold text-white shadow-soft transition hover:bg-ink-800 disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : mode === "password" ? (
            <>
              Sign in <ArrowRight className="h-4 w-4" />
            </>
          ) : (
            <>
              Email me a sign-in link <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="mt-8 rounded-2xl border border-ink-100 bg-ink-50/70 p-4 text-[13.5px] leading-relaxed text-ink-600">
        <p className="font-semibold text-ink-800">New to Hirewise Connect?</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/register?as=client" className="font-medium text-brand-600 hover:text-brand-700">
            Create a client account →
          </Link>
          <Link href="/register?as=talent" className="font-medium text-brand-600 hover:text-brand-700">
            Apply as talent →
          </Link>
        </div>
      </div>

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-400">
        Hirewise staff accounts are provisioned by an administrator. Admin roles require two-factor authentication.
      </p>
    </div>
  );
}

function inputCls(invalid: boolean, extra = "") {
  return cn(
    "h-12 w-full rounded-xl border bg-white px-4 text-[15px] text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-4",
    invalid
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-ink-200 hover:border-ink-300 focus:border-brand-500 focus:ring-brand-100",
    extra,
  );
}

function Field({
  label,
  htmlFor,
  error,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-[13.5px] font-semibold text-ink-800">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error && (
        <p className="mt-1.5 text-[12.5px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
