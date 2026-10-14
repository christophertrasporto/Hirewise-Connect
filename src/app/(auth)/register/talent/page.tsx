import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { prisma } from "@/server/db/client";
import { termsForRole } from "@/server/services/terms.service";

import { AgentRegisterForm } from "@/components/auth/AgentRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Apply as talent" };

export default async function RegisterTalentPage() {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  const terms = await termsForRole(prisma, "AGENT");
  return (
    <AuthShell>
      <AgentRegisterForm terms={terms} />
    </AuthShell>
  );
}
