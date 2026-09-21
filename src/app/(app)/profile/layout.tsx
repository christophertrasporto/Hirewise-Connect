import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/require-actor";
import { ProfileTabs } from "@/components/profile/ProfileTabs";

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.role !== "AGENT") redirect("/dashboard");
  return (
    <>
      <ProfileTabs />
      {children}
    </>
  );
}
