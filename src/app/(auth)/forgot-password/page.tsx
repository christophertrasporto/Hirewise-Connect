import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <div className="w-full max-w-[420px]">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
        <h1 className="mt-6 text-[2rem] font-bold leading-tight">Reset your password</h1>
        <p className="mt-2 text-[15px] text-ink-500">
          Enter your email and we will send a reset link if an account exists.
        </p>
        <form className="mt-6 space-y-4" action="#" method="post">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13.5px] font-semibold text-ink-800">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-[15px] placeholder:text-ink-300 hover:border-ink-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
            />
          </div>
          <button
            type="button"
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-ink-900 text-[15px] font-semibold text-white hover:bg-ink-800"
          >
            Send reset link
          </button>
          <p className="text-center text-[12.5px] text-ink-400">Demo build. Email delivery arrives in Phase 1.</p>
        </form>
      </div>
    </AuthShell>
  );
}
