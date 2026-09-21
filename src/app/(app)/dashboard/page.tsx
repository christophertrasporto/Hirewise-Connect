import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireAuth } from "@/server/auth/require-actor";
import { AgentDashboard } from "@/components/app/dashboards/AgentDashboard";
import { ClientDashboard } from "@/components/app/dashboards/ClientDashboard";
import { StaffDashboard } from "@/components/app/dashboards/StaffDashboard";
import { getOwnProfile, computeCompletion } from "@/server/services/agent.service";
import { getOwnClient } from "@/server/services/client.service";
import { staffDashboard, listNotifications } from "@/server/services/dashboard.service";
import { recommendedForClient, recentlyViewedForClient } from "@/server/services/search.service";
import { getOwnShortlist } from "@/server/services/shortlist.service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { actor, email } = await requireAuth();
  const notifications = await listNotifications(prisma, actor);

  if (actor.role === "AGENT") {
    const profile = await getOwnProfile(prisma, actor);
    return <AgentDashboard profile={profile} completion={computeCompletion(profile)} notifications={notifications} />;
  }
  if (actor.role === "CLIENT") {
    const client = await getOwnClient(prisma, actor);
    const active = client.status === "ACTIVE";
    const [recommended, recentlyViewed, shortlist] = active ? await Promise.all([recommendedForClient(prisma, actor), recentlyViewedForClient(prisma, actor), getOwnShortlist(prisma, actor)]) : [[], [], null];
    return <ClientDashboard client={client} notifications={notifications} recommended={recommended} recentlyViewed={recentlyViewed} shortlistCount={shortlist?.candidates.length ?? 0} />;
  }
  const stats = await staffDashboard(prisma, actor);
  return <StaffDashboard role={actor.role} email={email} stats={stats} notifications={notifications} />;
}
