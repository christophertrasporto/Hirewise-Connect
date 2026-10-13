import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ApplicantRegisterForm } from "@/components/auth/ApplicantRegisterForm";
import { getCurrentAuth } from "@/server/auth/require-actor";

export const metadata: Metadata = { title: "Apply to run an agency" };

export default async function RegisterAgencyPage() {
  if (await getCurrentAuth()) redirect("/apply/agency");
  return (
    <AuthShell>
      <ApplicantRegisterForm />
    </AuthShell>
  );
}
