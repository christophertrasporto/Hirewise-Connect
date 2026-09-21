"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { loginAction, magicLinkAction } from "@/app/(auth)/actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, Input, Checkbox, SubmitButton, FormAlert, DevLink } from "@/components/ui/Form";

export function LoginForm({ flash }: { flash?: { error?: string; verified?: boolean; reset?: boolean } }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [showPassword, setShowPassword] = useState(false);
  const [loginState, login] = useActionState(loginAction, idle);
  const [magicState, magic] = useActionState(magicLinkAction, idle as ActionResult<{ devUrl?: string }>);
  const state = mode === "password" ? loginState : magicState;
  const magicSent = mode === "magic" && magicState.ok;

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-8">
        <h1 className="text-[2rem] font-bold leading-tight">Welcome back</h1>
        <p className="mt-2 text-[15px] text-ink-500">Sign in to your Hirewise Connect account.</p>
      </div>

      {flash?.error && <div className="mb-5"><FormAlert>{flash.error}</FormAlert></div>}
      {flash?.verified && <div className="mb-5"><FormAlert tone="success">Email verified. Sign in to continue.</FormAlert></div>}
      {flash?.reset && <div className="mb-5"><FormAlert tone="success">Password updated. Sign in with your new password.</FormAlert></div>}

      <div className="mb-6 grid grid-cols-2 rounded-full bg-ink-100 p-1 text-[13.5px] font-semibold" role="tablist">
        {(["password", "magic"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("h-9 rounded-full transition-all", mode === m ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-800")}>
            {m === "password" ? "Password" : "Magic link"}
          </button>
        ))}
      </div>

      {mode === "password" ? (
        <form action={login} className="space-y-5" noValidate>
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@company.com" required className="pl-11" invalid={!!state.fieldErrors?.email} />
            </div>
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            error={state.fieldErrors?.password}
            trailing={
              <Link href="/forgot-password" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">
                Forgot password?
              </Link>
            }
          >
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" required className="pr-12 pl-11" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Checkbox name="remember" defaultChecked label="Keep me signed in on this device" />
          {state.error && <FormAlert>{state.error}</FormAlert>}
          <SubmitButton pendingText="Signing in…" className="w-full">
            Sign in <ArrowRight className="h-4 w-4" />
          </SubmitButton>
        </form>
      ) : (
        <form action={magic} className="space-y-5" noValidate>
          <Field label="Email" htmlFor="magic-email" error={state.fieldErrors?.email}>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input id="magic-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@company.com" required className="pl-11" />
            </div>
          </Field>
          {magicSent ? (
            <FormAlert tone="success">If an account exists for that email, a sign-in link is on its way. It expires in 15 minutes.</FormAlert>
          ) : (
            state.error && <FormAlert>{state.error}</FormAlert>
          )}
          <DevLink url={magicState.data?.devUrl} label="magic link:" />
          <SubmitButton pendingText="Sending…" className="w-full">
            Email me a sign-in link <ArrowRight className="h-4 w-4" />
          </SubmitButton>
        </form>
      )}

      <div className="mt-8 rounded-2xl border border-ink-100 bg-ink-50/70 p-4 text-[13.5px] leading-relaxed text-ink-600">
        <p className="font-semibold text-ink-800">New to Hirewise Connect?</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/register/client" className="font-medium text-brand-600 hover:text-brand-700">
            Create a client account →
          </Link>
          <Link href="/register/talent" className="font-medium text-brand-600 hover:text-brand-700">
            Apply as talent →
          </Link>
        </div>
      </div>

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-400">Hirewise staff accounts are provisioned by an administrator. Admin roles require two-factor authentication.</p>
    </div>
  );
}
