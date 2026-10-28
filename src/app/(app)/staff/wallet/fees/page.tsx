import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listPendingFees } from "@/server/services/wallet.service";
import { Card, EmptyState, fmtDate } from "@/components/app/ui";
import { FeeForm, FeeImportForm } from "@/components/wallet/StaffWalletForms";

export const metadata: Metadata = { title: "Gateway fees" };

export default async function StaffFeesPage() {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const pending = await listPendingFees(prisma, actor);
  return (
    <div className="space-y-5">
      <Card
        title="Sales waiting for the real gateway fee"
        description="An online (Maya) sale earns nothing for the coach until the exact fee Maya charged is recorded. Enter it here, or import the Maya settlement report below. The app never estimates a fee. Bank and GCash payments recorded by staff have no gateway fee and do not appear here."
      >
        {pending.length === 0 ? (
          <EmptyState title="No sales are waiting for a fee" />
        ) : (
          <ul className="divide-y divide-ink-100">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[14.5px] font-semibold text-ink-900">
                    {p.courseTitle} <span className="font-normal text-ink-500">· {p.buyer} · {p.saleLabel}</span>
                  </p>
                  <p className="text-[12.5px] text-ink-400">
                    Paid {fmtDate(p.paidAt)} · coach {p.coachEmail} · enrolment <span className="font-mono">{p.enrollmentId}</span>
                  </p>
                </div>
                <FeeForm earningId={p.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Import a settlement report"
        description="Download the settlement report from Maya Business Manager as a CSV and upload it. Each row is matched to a sale by its Maya payment id, our reference number, or the enrolment id, and its fee is recorded. Rows that match nothing, or sales whose fee is already recorded, are left alone and reported."
      >
        <FeeImportForm />
      </Card>
    </div>
  );
}
