import { LayoutDashboard, UserCircle, Building2, FileSignature, Users, Bell, Film, Search, Bookmark, ClipboardCheck, ListChecks, CalendarClock, ClipboardList, Handshake, Lock, ShieldAlert, GraduationCap, Receipt, BarChart3, LineChart, UserCog, Settings, Rocket, Fingerprint, ShieldCheck, MessageSquare, Flag, Briefcase, Gift, Wallet } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireAuth } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { ROLE_NAMES } from "@/server/policies/permissions";
import { notificationRepository } from "@/server/repositories/notification.repository";
import { AppShell, type NavItem, type ShellTone } from "@/components/app/AppShell";
import { logoutAction } from "@/app/(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const { actor } = auth;

  const nav: NavItem[] = [{ href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard /> }];
  if (actor.role === "AGENT" && actor.agentProfileId) {
    nav.push({ href: "/profile", label: "My profile", icon: <UserCircle /> });
    nav.push({ href: "/profile/media", label: "Video & voice", icon: <Film /> });
    nav.push({ href: "/opportunities", label: "Opportunities", icon: <Briefcase /> });
    nav.push({ href: "/interviews", label: "Interviews", icon: <CalendarClock /> });
    nav.push({ href: "/placements", label: "Placements", icon: <Handshake /> });
    nav.push({ href: "/courses", label: "Courses", icon: <GraduationCap /> });
    nav.push({ href: "/refer", label: "Refer & Earn", icon: <Gift /> });
  }
  if (actor.role === "CLIENT") {
    nav.push({ href: "/talent", label: "Find talent", icon: <Search /> });
    nav.push({ href: "/partners", label: "Partner Teams", icon: <ShieldCheck /> });
    nav.push({ href: "/opportunities", label: "Opportunities", icon: <Briefcase /> });
    nav.push({ href: "/shortlist", label: "Shortlist", icon: <Bookmark /> });
    nav.push({ href: "/interviews", label: "Interviews", icon: <CalendarClock /> });
    nav.push({ href: "/requirements", label: "Requirements", icon: <ClipboardList /> });
    nav.push({ href: "/placements", label: "Placements", icon: <Handshake /> });
    nav.push({ href: "/billing", label: "Billing", icon: <Receipt /> });
    nav.push({ href: "/company", label: "Company", icon: <Building2 /> });
  }
  if (can(actor, "client.read")) nav.push({ href: "/staff/clients", label: "Clients", icon: <Building2 /> });
  if (can(actor, "agent.read_public") && actor.role !== "COACH") nav.push({ href: "/staff/talent", label: "Talent", icon: <Users /> });
  if (can(actor, "media.review")) nav.push({ href: "/staff/media", label: "Media review", icon: <ClipboardCheck /> });
  if (can(actor, "shortlist.read_all")) nav.push({ href: "/staff/shortlists", label: "Shortlist activity", icon: <ListChecks /> });
  if (can(actor, "opportunity.manage") || can(actor, "requirement.read")) nav.push({ href: "/staff/opportunities", label: "Opportunities", icon: <Briefcase /> });
  if (can(actor, "interview.read_all")) nav.push({ href: "/staff/interviews", label: "Interview requests", icon: <CalendarClock /> });
  if (can(actor, "placement.read_all")) nav.push({ href: "/staff/placements", label: "Placements", icon: <Handshake /> });
  if (can(actor, "reservation.manage")) nav.push({ href: "/staff/reservations", label: "Reservations", icon: <Lock /> });
  if (can(actor, "billing_rate.approve") || can(actor, "invoice.manage") || can(actor, "deposit.read")) nav.push({ href: "/staff/commercial", label: "Commercial", icon: <Receipt /> });
  if (can(actor, "report.revenue") || can(actor, "report.pipeline")) nav.push({ href: "/staff/reports", label: "Reports", icon: <BarChart3 /> });
  if (can(actor, "report.talent") || can(actor, "report.pipeline") || can(actor, "report.academy") || can(actor, "client.read")) nav.push({ href: "/staff/analytics", label: "Analytics", icon: <LineChart /> });
  if (can(actor, "user.manage")) nav.push({ href: "/staff/users", label: "Users", icon: <UserCog /> });
  if (can(actor, "agreement.manage")) nav.push({ href: "/staff/agreements", label: "Agreements", icon: <FileSignature /> });
  if (can(actor, "identity.review") || can(actor, "identity.read")) nav.push({ href: "/staff/identity", label: "Identity", icon: <Fingerprint /> });
  if (can(actor, "agency.read") || can(actor, "agency.review") || can(actor, "agency.manage")) nav.push({ href: "/staff/agencies", label: "Agencies", icon: <Building2 /> });
  if (can(actor, "settings.manage")) nav.push({ href: "/staff/settings", label: "Settings", icon: <Settings /> });
  if (can(actor, "settings.manage")) nav.push({ href: "/staff/launch", label: "Launch readiness", icon: <Rocket /> });
  if (can(actor, "interview.coordinate") || can(actor, "flag.review")) nav.push({ href: "/staff/compliance", label: "Compliance", icon: <ShieldAlert /> });
  if (actor.role === "CLIENT" || actor.role === "AGENT" || actor.agency) {
    nav.push({ href: "/messages", label: "Messages", icon: <MessageSquare /> });
    nav.push({ href: "/report-bypass", label: "Report a bypass attempt", icon: <Flag /> });
  }
  if (actor.role === "AGENCY_OWNER" || actor.role === "COACH") nav.push({ href: "/refer", label: "Refer & Earn", icon: <Gift /> });
  if (actor.role === "COACH") nav.push({ href: "/coach/profile", label: "Coach profile", icon: <UserCircle /> });
  // Coach wallet: coaches see their own; staff who manage wallets see everyone's.
  if (actor.role === "COACH" && can(actor, "coach.wallet")) nav.push({ href: "/wallet", label: "Wallet", icon: <Wallet /> });
  if (can(actor, "wallet.manage")) nav.push({ href: "/staff/wallet", label: "Coach wallets", icon: <Wallet /> });
  if (can(actor, "referral.manage") || can(actor, "payout.manage")) nav.push({ href: can(actor, "referral.manage") ? "/staff/referrals" : "/staff/referrals/payouts", label: "Referrals", icon: <Gift /> });
  if (actor.agency) nav.splice(1, 0, { href: "/agency", label: "My agency", icon: <Building2 /> });
  else if (actor.role === "AGENT" || actor.role === "CLIENT" || actor.role === "APPLICANT") nav.push({ href: "/apply/agency", label: "Apply for Agency", icon: <Building2 /> });
  if (actor.role === "AGENT" || actor.role === "CLIENT") nav.push({ href: "/account/agreements", label: "Agreements", icon: <FileSignature /> });
  nav.push({ href: "/notifications", label: "Notifications", icon: <Bell /> });
  if (can(actor, "course.create_own") || can(actor, "course.manage") || can(actor, "course.payment.record") || can(actor, "certification.review")) nav.splice(1, 0, { href: "/courses", label: "Courses", icon: <GraduationCap /> });

  const tone: ShellTone = actor.role === "AGENT" || actor.role === "CLIENT" || actor.role === "APPLICANT" || actor.role === "AGENCY_OWNER" || actor.role === "AGENCY_MANAGER" ? "app" : "staff";
  const unread = (await notificationRepository.listForUser(prisma, actor.userId, 50)).filter((n) => !n.readAt).length;

  return (
    <AppShell nav={nav} email={auth.email} roleLabel={ROLE_NAMES[actor.role].name} unread={unread} tone={tone} onLogout={logoutAction}>
      {children}
    </AppShell>
  );
}
