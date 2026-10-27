import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { getPromoRedemptions, listCoursesForPromo, listPromos } from "@/server/services/promo.service";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/app/ui";
import { PromoForm, PromoStatusButtons } from "@/components/academy/PromoStaff";

export const metadata: Metadata = { title: "Academy · Promo codes" };

const EFFECTIVE_TONE: Record<string, string> = {
  ACTIVE: "bg-brand-50 text-brand-700",
  SCHEDULED: "bg-gold-50 text-gold-700",
  EXPIRED: "bg-ink-100 text-ink-600",
  FULLY_USED: "bg-ink-100 text-ink-600",
  PAUSED: "bg-gold-50 text-gold-700",
  ARCHIVED: "bg-ink-100 text-ink-500",
};

export default async function StaffPromoCodesPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const actor = await requireActor();
  authorize(actor, "promo.manage");
  const { code } = await searchParams;
  const [promos, courses] = await Promise.all([listPromos(prisma, actor), listCoursesForPromo(prisma, actor)]);
  const open = code ? promos.find((p) => p.id === code) : null;
  const uses = open ? await getPromoRedemptions(prisma, actor, open.id) : [];
  return (
    <div className="space-y-5">
      <Card title="New promo code" description="A code lowers a course price before the learner pays, in Maya or by bank transfer. One code per enrolment. Every change is audited.">
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold text-brand-700">Create a code</summary>
          <div className="mt-4">
            <PromoForm courses={courses} />
          </div>
        </details>
      </Card>
      <Card title="Promo codes" description="Used counts reserved and paid uses. A reserved use is given back when the learner removes the code or leaves the course unpaid for the reservation period.">
        {promos.length === 0 ? (
          <EmptyState title="No promo codes yet" />
        ) : (
          <ul className="divide-y divide-ink-100">
            {promos.map((p) => (
              <li key={p.id} className="py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">
                      <span className="font-mono">{p.code}</span> <span className="font-normal text-ink-400">· {p.label}</span>{" "}
                      <span className={`ml-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${EFFECTIVE_TONE[p.effective] ?? ""}`}>{p.effective.replace("_", " ")}</span>
                    </p>
                    <p className="text-[12.5px] text-ink-500">
                      {p.discount} · {p.appliesTo === "ALL_COURSES" ? "all courses" : p.courses.map((c) => c.title).join(", ")}
                      {p.startsOn || p.endsOn ? ` · ${p.startsOn || "any time"} to ${p.endsOn || "no end"}` : ""}
                      {p.minPrice ? ` · from ${p.minPrice}` : ""}
                    </p>
                    <p className="text-[12.5px] text-ink-400">
                      Used {p.consumed + p.reserved}
                      {p.maxRedemptions !== null ? ` of ${p.maxRedemptions}` : ""} ({p.consumed} paid, {p.reserved} reserved) · {p.perLearnerLimit} per learner
                      {p.discountGiven.length ? ` · discounts given ${p.discountGiven.map((d) => d.label).join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/staff/academy/promos?code=${p.id}`} className="text-[13px] font-semibold text-brand-700 hover:text-brand-800">
                      Who used it
                    </a>
                    <PromoStatusButtons promoId={p.id} status={p.status} />
                  </div>
                </div>
                {p.status !== "ARCHIVED" && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Edit</summary>
                    <div className="mt-3">
                      <PromoForm promo={p} courses={courses} />
                    </div>
                  </details>
                )}
                {open?.id === p.id && (
                  <div className="mt-3 rounded-xl border border-ink-100 p-3">
                    {uses.length === 0 ? (
                      <p className="text-[13px] text-ink-500">Nobody has used this code yet.</p>
                    ) : (
                      <ul className="divide-y divide-ink-100 text-[13px]">
                        {uses.map((u) => (
                          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                              <span className="font-semibold text-ink-900">{u.learner}</span> <span className="text-ink-400">· {u.email} · {u.course}</span>
                            </span>
                            <span className="text-ink-500">
                              {u.listLabel} − {u.discountLabel} = <strong className="text-ink-800">{u.finalLabel}</strong> · <StatusBadge status={u.status} /> · {fmtDate(u.createdAt)}
                              {u.releaseReason ? ` · ${u.releaseReason}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
