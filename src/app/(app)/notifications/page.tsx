import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listNotifications } from "@/server/services/dashboard.service";
import { PageHeader, Card } from "@/components/app/ui";
import { NotificationList } from "@/components/app/NotificationList";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireActor();
  const items = await listNotifications(prisma, actor);
  return (
    <>
      <PageHeader title="Notifications" description="In-app notifications. Email copies follow your preferences." />
      <Card>
        <NotificationList items={items} />
      </Card>
    </>
  );
}
