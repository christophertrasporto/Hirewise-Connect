import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listDepositPolicies } from "@/server/services/billing.service";
import { getSetting } from "@/server/services/setting.service";
import { Card } from "@/components/app/ui";
import { DepositPolicyForm } from "@/components/commercial/DepositPolicyForm";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Deposit policies" };

export default async function DepositPoliciesPage() {
  const actor = await requireActor();
  authorize(actor, "settings.manage");
  const [policies, hours] = await Promise.all([listDepositPolicies(prisma, actor), getSetting(prisma, "hoursPerMonthDefault")]);
  return (
    <Card title="Deposit policies" description={`One month = rate × ${hours} hours for hourly rates (Setting hoursPerMonthDefault), or the monthly rate. The default policy is applied at Hirewise approval unless another is chosen.`}>
      <div className="space-y-6">
        {policies.map((p) => (
          <details key={p.id} className="rounded-2xl border border-ink-100 p-4">
            <summary className="cursor-pointer text-[14.5px] font-semibold text-ink-900">{p.name} <span className="font-normal text-ink-400">· {labelFor(p.type)}{p.isDefault ? " · default" : ""}{!p.isActive ? " · inactive" : ""}</span></summary>
            <div className="mt-4"><DepositPolicyForm p={{ id: p.id, name: p.name, type: p.type, value: p.value, currency: p.currency, isDefault: p.isDefault, isActive: p.isActive }} /></div>
          </details>
        ))}
        <details className="rounded-2xl border border-dashed border-ink-200 p-4"><summary className="cursor-pointer text-[14.5px] font-semibold text-brand-700">+ New policy</summary><div className="mt-4"><DepositPolicyForm /></div></details>
      </div>
    </Card>
  );
}
