import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listAccessCodes, listPayableCourses } from "@/server/services/access-code.service";
import { Card, EmptyState, fmtDate } from "@/components/app/ui";
import { AccessCodeForm, VoidCodeForm } from "@/components/academy/AccessCodeStaff";

export const metadata: Metadata = { title: "Academy · Access codes" };

const TONE: Record<string, string> = {
  UNUSED: "bg-brand-50 text-brand-700",
  REDEEMED: "bg-ink-100 text-ink-600",
  VOIDED: "bg-ink-100 text-ink-500",
  EXPIRED: "bg-gold-50 text-gold-700",
};

export default async function StaffAccessCodesPage() {
  const actor = await requireActor();
  authorize(actor, "course.payment.record");
  const [codes, payable] = await Promise.all([listAccessCodes(prisma, actor), listPayableCourses(prisma, actor)]);
  return (
    <div className="space-y-5">
      <Card title="New access code" description="Use this after you have confirmed a bank transfer or GCash payment. The buyer enters the code on the course page and the course opens. The payment is recorded at the course price, so the coach earning and any referral commission are created exactly as if you had recorded it yourself.">
        <AccessCodeForm courses={payable} />
      </Card>
      <Card title="Access codes" description="A code works once, for one course, until it expires. Void an unused code you issued by mistake.">
        {codes.length === 0 ? (
          <EmptyState title="No access codes yet" />
        ) : (
          <ul className="divide-y divide-ink-100">
            {codes.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">
                      <span className="select-all font-mono">{c.code}</span> <span className="font-normal text-ink-400">· {c.courseTitle}</span>{" "}
                      <span className={`ml-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[c.status] ?? ""}`}>{c.status}</span>
                    </p>
                    <p className="text-[12.5px] text-ink-500">
                      Ref {c.paymentReference}
                      {c.buyerEmail ? ` · for ${c.buyerEmail}` : " · any buyer"} · issued {fmtDate(c.createdAt)}
                      {c.createdBy ? ` by ${c.createdBy}` : ""}
                      {c.status === "UNUSED" || c.status === "EXPIRED" ? ` · expires ${fmtDate(c.expiresAt)}` : ""}
                      {c.redeemedBy ? ` · used by ${c.redeemedBy} on ${fmtDate(c.redeemedAt)}` : ""}
                      {c.voidReason ? ` · voided: ${c.voidReason}` : ""}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  {c.status === "UNUSED" && <VoidCodeForm id={c.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
