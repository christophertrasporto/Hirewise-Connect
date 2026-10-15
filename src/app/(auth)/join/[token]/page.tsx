import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { AgentRegisterForm } from "@/components/auth/AgentRegisterForm";
import { JoinButton } from "@/components/agency/SeatPanels";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { joinPageInfo } from "@/server/services/invite.service";
import { termsForRole } from "@/server/services/terms.service";

export const metadata: Metadata = { title: "Join an agency" };

/**
 * v2 phase 2: the agency's invitation link. Visitors create a talent account (same form, same terms checkbox) and
 * join in one step; signed-in talent joins with one click. The page shows the agency name and nothing else.
 */
export default async function JoinAgencyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [info, auth] = await Promise.all([joinPageInfo(prisma, token), getCurrentAuth()]);
  if (!info) {
    return (
      <AuthShell>
        <div className="w-full max-w-[520px]">
          <h1 className="text-[2rem] font-bold leading-tight">This invitation link is not valid</h1>
          <p className="mt-3 text-[15px] text-ink-500">Ask the agency for a current link, or <Link href="/register/talent" className="font-semibold text-brand-700 underline">apply as talent</Link> on your own.</p>
        </div>
      </AuthShell>
    );
  }
  const header = (
    <>
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">Agency invitation</p>
      <h1 className="mt-3 text-[2rem] font-bold leading-tight">{info.label}</h1>
      <p className="mt-2 text-[15px] text-ink-500">{info.agencyName} runs its team on Hirewise Connect. Hirewise trains and certifies agents, shares client opportunities, and handles clients, interviews, contracts, and billing. Joining takes one of the agency&apos;s Agent Seats; you keep one Hirewise profile.</p>
    </>
  );
  if (!info.accepting) {
    return (
      <AuthShell>
        <div className="w-full max-w-[560px]">
          {header}
          <div className="mt-6 rounded-2xl border border-gold-200 bg-gold-50 p-4 text-[14px] text-gold-900">{info.reason}</div>
        </div>
      </AuthShell>
    );
  }
  if (auth) {
    const talent = auth.actor.role === "AGENT" && !!auth.actor.agentProfileId;
    return (
      <AuthShell>
        <div className="w-full max-w-[560px]">
          {header}
          <div className="mt-6 space-y-3">
            <p className="text-[14px] text-ink-700">You are signed in as <span className="font-semibold">{auth.email}</span>.</p>
            {talent ? <JoinButton token={token} agencyName={info.agencyName} /> : <p className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4 text-[13.5px] text-ink-600">Only talent accounts can join an agency. Sign out to create a talent account from this link, or sign in with your talent account.</p>}
          </div>
        </div>
      </AuthShell>
    );
  }
  const terms = await termsForRole(prisma, "AGENT");
  return (
    <AuthShell>
      <AgentRegisterForm terms={terms} join={{ token, agencyName: info.agencyName, email: info.email }} />
    </AuthShell>
  );
}
