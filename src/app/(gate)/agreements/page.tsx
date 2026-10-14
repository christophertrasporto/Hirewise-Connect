import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { agreementsFor } from "@/server/services/agreement.service";
import { termsForRole, termsStatusFor } from "@/server/services/terms.service";
import { AgreementList } from "@/components/gate/AgreementList";
import { TermsReacceptance } from "@/components/gate/TermsReacceptance";

export const metadata: Metadata = { title: "Review agreements" };

/**
 * Identity phase 1: the unified Terms & Platform Agreement is one checkbox (new accounts that pre-date it, and
 * material new versions). Transactional agreements that still require their own step are listed underneath.
 */
export default async function AgreementsPage() {
  const auth = await requireAuth("email");
  const gate = nextGate(auth);
  if (gate && gate !== "/agreements") redirect(gate);
  const [status, agreements] = await Promise.all([termsStatusFor(prisma, auth.actor), agreementsFor(prisma, auth.actor)]);
  const remaining = agreements.filter((a) => !a.accepted).length;
  if (!status.required && remaining === 0) redirect(HOME_PATH);
  const bundle = status.required ? await termsForRole(prisma, auth.actor.role) : null;
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">Before you continue</p>
      {status.required && bundle ? (
        <>
          <h1 className="mt-3 text-[2rem] font-bold leading-tight">{status.reason === "MATERIAL_CHANGE" ? "The Terms & Platform Agreement was updated" : "Accept the Hirewise Connect Terms & Platform Agreement"}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
            One document covers everyone on Hirewise Connect; the sections that apply to your role are opened first. We record the version you accept, when, and from which device.
          </p>
          <TermsReacceptance bundle={bundle} reason={status.reason} acceptedVersion={status.acceptedTermsVersion} />
        </>
      ) : null}
      {agreements.length > 0 && (
        <div className={status.required ? "mt-12" : ""}>
          <h2 className="mt-3 text-[1.5rem] font-bold leading-tight">Review and accept the {auth.actor.role === "CLIENT" ? "client" : "talent"} agreements</h2>
          <p className="mt-2 text-[14px] text-ink-500">Each agreement is accepted individually. {remaining > 0 ? `${remaining} of ${agreements.length} remaining.` : "All accepted."}</p>
          <AgreementList agreements={agreements.map((a) => ({ id: a.id, type: a.type, version: a.version, title: a.title, bodyMarkdown: a.bodyMarkdown, accepted: a.accepted }))} />
        </div>
      )}
    </div>
  );
}
