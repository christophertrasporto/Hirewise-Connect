import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Log in", description: "Sign in to Hirewise Connect." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; verified?: string; reset?: string }> }) {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  const sp = await searchParams;
  return (
    <AuthShell
      aside={
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">What happens after sign-in</p>
          <ul className="mt-3 space-y-2 text-[13.5px] text-ink-200">
            <li>Clients: browse verified talent once Hirewise activates the account.</li>
            <li>Talent: complete the profile checklist and submit for review.</li>
            <li>Staff: two-factor code, then the operations console.</li>
          </ul>
        </div>
      }
    >
      <LoginForm flash={{ error: sp.error, verified: sp.verified === "1", reset: sp.reset === "1" }} />
    </AuthShell>
  );
}
