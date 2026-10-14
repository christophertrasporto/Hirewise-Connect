import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { prisma } from "@/server/db/client";
import { termsForRole } from "@/server/services/terms.service";

import { ClientRegisterForm } from "@/components/auth/ClientRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Create a client account" };

export default async function RegisterClientPage() {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  const terms = await termsForRole(prisma, "CLIENT");
  return (
    <AuthShell>
      <ClientRegisterForm terms={terms} />
    </AuthShell>
  );
}
