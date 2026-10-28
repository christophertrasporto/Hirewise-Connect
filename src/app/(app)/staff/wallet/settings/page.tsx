import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { walletSettings } from "@/server/services/wallet.service";
import { Card } from "@/components/app/ui";
import { WalletSettingsForm } from "@/components/wallet/StaffWalletForms";

export const metadata: Metadata = { title: "Wallet settings" };

export default async function StaffWalletSettingsPage() {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const s = await walletSettings(prisma, actor);
  return (
    <Card title="Split and hold" description="The coach gets this share of the net of each sale (the price paid minus the gateway fee), rounded down; Hirewise gets the rest, including any leftover centavo, and the referral commission is paid out of Hirewise's share. An earning becomes withdrawable after the refund window plus the extra hold. Changes apply to new sales only: every earning keeps the split and the hold it was made with.">
      <WalletSettingsForm s={s} />
    </Card>
  );
}
