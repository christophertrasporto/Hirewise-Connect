import type { Metadata } from "next";
import { Banner } from "@/components/app/ui";
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
import { onboardingFor } from "@/server/services/onboarding.service";
import { listRequestsForClient, listRequestsForAgent } from "@/server/services/interview.service";
import { listPlacementsForClient, listPlacementsForAgent } from "@/server/services/placement.service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ verified?: string }> }) {
  const { actor, email } = await requireAuth();
  const sp = searchParams ? await searchParams : {};
  const justVerified = sp.verified === "1";
  const notifications = await listNotifications(prisma, actor);

  if (actor.role === "AGENT") {
    const profile = await getOwnProfile(prisma, actor);
    const completion = computeCompletion(profile);
    const [requests, placements, onboarding] = await Promise.all([listRequestsForAgent(prisma, actor), listPlacementsForAgent(prisma, actor), onboardingFor(prisma, actor, { liveProfilePercent: completion.total })]);
    return <>{justVerified && <div className="mb-6"><Banner tone="success" title="Email verified successfully">Continue your onboarding below.</Banner></div>}<AgentDashboard profile={profile} completion={completion} onboarding={onboarding} notifications={notifications} requests={requests.map((r) => ({ id: r.id, role: r.role, status: r.status, companyName: r.companyName, myStatus: r.myStatus, next: r.interviews.find((i) => i.status === "SCHEDULED") ? { scheduledAt: r.interviews.find((i) => i.status === "SCHEDULED")!.scheduledAt, timezone: r.interviews.find((i) => i.status === "SCHEDULED")!.timezone } : null }))} placements={placements.map((p) => ({ id: p.id, status: p.status, positionTitle: p.positionTitle, companyName: p.client.companyName }))} /></>;
  }
  if (actor.role === "CLIENT") {
    const client = await getOwnClient(prisma, actor);
    const active = client.status === "ACTIVE";
    const [recommended, recentlyViewed, shortlist, requests, placements] = active ? await Promise.all([recommendedForClient(prisma, actor), recentlyViewedForClient(prisma, actor), getOwnShortlist(prisma, actor), listRequestsForClient(prisma, actor), listPlacementsForClient(prisma, actor)]) : [[], [], null, [], []];
    const openRequests = requests.filter((r) => !["CLOSED", "CANCELLED"].includes(r.status));
    const upcoming = requests.flatMap((r) => r.interviews.filter((i) => i.status === "SCHEDULED").map((i) => ({ id: i.id, requestId: r.id, displayName: i.displayName, scheduledAt: i.scheduledAt, timezone: i.timezone }))).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).slice(0, 5);
    return <>{justVerified && <div className="mb-6"><Banner tone="success" title="Email verified successfully">Welcome to Hirewise Connect.</Banner></div>}<ClientDashboard client={client} notifications={notifications} recommended={recommended} recentlyViewed={recentlyViewed} shortlistCount={shortlist?.candidates.length ?? 0} openRequests={openRequests.length} decisionsPending={requests.filter((r) => r.status === "CLIENT_DECISION_PENDING").length} upcoming={upcoming} placements={placements.map((p) => ({ id: p.id, status: p.status, positionTitle: p.positionTitle, displayName: p.agent.displayName }))} /></>;
  }
  const stats = await staffDashboard(prisma, actor);
  return <StaffDashboard role={actor.role} email={email} stats={stats} notifications={notifications} />;
}
