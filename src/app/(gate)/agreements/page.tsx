import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { agreementsFor } from "@/server/services/agreement.service";
import { AgreementList } from "@/components/gate/AgreementList";

export const metadata: Metadata = { title: "Review agreements" };

export default async function AgreementsPage() {
  const auth = await requireAuth("email");
  const gate = nextGate(auth);
  if (gate && gate !== "/agreements") redirect(gate);
  const agreements = await agreementsFor(prisma, auth.actor);
  if (agreements.length === 0) redirect(HOME_PATH);
  const remaining = agreements.filter((a) => !a.accepted).length;
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">Before you continue</p>
      <h1 className="mt-3 text-[2rem] font-bold leading-tight">Review and accept the {auth.actor.role === "CLIENT" ? "client" : "talent"} agreements</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
        Each agreement is accepted individually. We record the version you accepted, when, and from which device. {remaining > 0 ? `${remaining} of ${agreements.length} remaining.` : "All accepted."}
      </p>
      <AgreementList agreements={agreements.map((a) => ({ id: a.id, type: a.type, version: a.version, title: a.title, bodyMarkdown: a.bodyMarkdown, accepted: a.accepted }))} />
    </div>
  );
}
