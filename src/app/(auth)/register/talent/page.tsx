import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { prisma } from "@/server/db/client";
import { termsForRole } from "@/server/services/terms.service";

import { AgentRegisterForm } from "@/components/auth/AgentRegisterForm";
import { AgentQuickRegisterForm } from "@/components/auth/AgentQuickRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Apply as talent" };

/** `?quick=1` is the short sign-up (name, email, password, terms) for someone who came to buy a course. */
export default async function RegisterTalentPage({ searchParams }: { searchParams: Promise<{ quick?: string }> }) {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  const { quick } = await searchParams;
  const terms = await termsForRole(prisma, "AGENT");
  return <AuthShell>{quick === "1" ? <AgentQuickRegisterForm terms={terms} /> : <AgentRegisterForm terms={terms} />}</AuthShell>;
}
