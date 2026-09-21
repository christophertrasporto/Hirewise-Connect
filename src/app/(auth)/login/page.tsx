import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to Hirewise Connect.",
};

export default function LoginPage() {
  return (
    <AuthShell
      aside={
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Latest activity</p>
          <ul className="mt-3 space-y-2.5 text-[13.5px]">
            <li className="flex items-center justify-between gap-4">
              <span className="text-ink-200">Interview scheduled · Maria S.</span>
              <span className="text-ink-400">Thu 9:00 PST</span>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-ink-200">Deposit invoice issued · Placement #0421</span>
              <span className="text-ink-400">Today</span>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-ink-200">Certification approved · Cold Calling</span>
              <span className="text-ink-400">Yesterday</span>
            </li>
          </ul>
        </div>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
