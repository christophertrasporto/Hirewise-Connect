import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ClientRegisterForm } from "@/components/auth/ClientRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Create a client account" };

export default async function RegisterClientPage() {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  return (
    <AuthShell>
      <ClientRegisterForm />
    </AuthShell>
  );
}
