import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPendingCoursePayments } from "@/server/services/academy.service";
import { priceLabel } from "@/server/views/academy.views";
import { Card, EmptyState, fmtDate } from "@/components/app/ui";
import { PaymentForm } from "@/components/academy/CourseActions";

export const metadata: Metadata = { title: "Academy · Payments" };

export default async function StaffAcademyPaymentsPage() {
  const actor = await requireActor();
  const rows = await listPendingCoursePayments(prisma, actor);
  return (
    <Card title="Pending course payments" description="Talent pays Hirewise offline (bank transfer, GCash). Record the amount and reference, or waive with a reason. Every entry is audited.">
      {rows.length === 0 ? <EmptyState title="No pending payments" /> : (
        <ul className="divide-y divide-ink-100">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[15px] font-semibold text-ink-900"><Link href={`/staff/talent/${e.agentProfile.id}`} className="hover:text-brand-700">{e.agentProfile.displayName}</Link> <span className="font-normal text-ink-400">· {e.course.title}</span></p>
                <p className="text-[12.5px] text-ink-400">Enrolled {fmtDate(e.enrolledAt)} · due {priceLabel(e.priceCents)}</p>
              </div>
              <PaymentForm enrollmentId={e.id} priceLabel={priceLabel(e.priceCents)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
