import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPendingCoursePayments, listRecentPaidEnrollments } from "@/server/services/academy.service";
import { priceLabel } from "@/server/views/academy.views";
import { Card, EmptyState, fmtDate } from "@/components/app/ui";
import { PaymentForm } from "@/components/academy/CourseActions";
import { RefundForm } from "@/components/referral/StaffForms";

export const metadata: Metadata = { title: "Academy · Payments" };

export default async function StaffAcademyPaymentsPage() {
  const actor = await requireActor();
  const [rows, paid] = await Promise.all([listPendingCoursePayments(prisma, actor), listRecentPaidEnrollments(prisma, actor)]);
  return (
    <div className="space-y-5">
    <Card title="Pending course payments" description="Talent pays Hirewise offline (bank transfer, GCash). Record the amount and reference, or waive with a reason. Every entry is audited.">
      {rows.length === 0 ? <EmptyState title="No pending payments" /> : (
        <ul className="divide-y divide-ink-100">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[15px] font-semibold text-ink-900"><Link href={`/staff/talent/${e.agentProfile.id}`} className="hover:text-brand-700">{e.agentProfile.displayName}</Link> <span className="font-normal text-ink-400">· {e.course.title}</span></p>
                <p className="text-[12.5px] text-ink-400">Enrolled {fmtDate(e.enrolledAt)} · due {priceLabel(e.priceCents, e.currency)}{e.listPriceCents != null && e.listPriceCents > e.priceCents ? ` (list ${priceLabel(e.listPriceCents, e.currency)}, promo code applied)` : ""}</p>
              </div>
              <PaymentForm enrollmentId={e.id} priceLabel={priceLabel(e.priceCents, e.currency)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
    <Card title="Recently paid" description="If the money goes back (a refund or a chargeback), record it here: the course access ends and any referral commission on the sale is reversed.">
      {paid.length === 0 ? <EmptyState title="Nothing paid yet" /> : (
        <ul className="divide-y divide-ink-100">
          {paid.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[14.5px] font-semibold text-ink-900">{e.agentProfile.displayName} <span className="font-normal text-ink-500">· {e.course.title}</span></p>
                <p className="text-[12.5px] text-ink-400">Paid {priceLabel(e.paidCents ?? e.priceCents, e.currency)}{e.paymentReference ? ` · ref ${e.paymentReference}` : ""}{e.paidAt ? ` · ${fmtDate(e.paidAt)}` : ""}</p>
              </div>
              <RefundForm target="ENROLLMENT" id={e.id} />
            </li>
          ))}
        </ul>
      )}
    </Card>
    </div>
  );
}
