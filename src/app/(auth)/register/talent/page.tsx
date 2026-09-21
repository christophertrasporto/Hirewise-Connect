import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { AgentRegisterForm } from "@/components/auth/AgentRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Apply as talent" };

export default async function RegisterTalentPage() {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  return (
    <AuthShell>
      <AgentRegisterForm />
    </AuthShell>
  );
}
