import { LayoutDashboard, UserCircle, Building2, FileSignature, Users, Bell, Film, Search, Bookmark, ClipboardCheck, ListChecks, CalendarClock, ClipboardList, Handshake, Lock, ShieldAlert, GraduationCap, Award, Receipt, BarChart3, LineChart, UserCog } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireAuth } from "@/server/auth/require-actor";
import { can } from "@/server/policies/authorize";
import { ROLE_NAMES } from "@/server/policies/permissions";
import { notificationRepository } from "@/server/repositories/notification.repository";
import { AppShell, type NavItem } from "@/components/app/AppShell";
import { logoutAction } from "@/app/(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const { actor } = auth;

  const nav: NavItem[] = [{ href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard /> }];
  if (actor.role === "AGENT") {
    nav.push({ href: "/profile", label: "My profile", icon: <UserCircle /> });
    nav.push({ href: "/profile/media", label: "Video & voice", icon: <Film /> });
    nav.push({ href: "/interviews", label: "Interviews", icon: <CalendarClock /> });
    nav.push({ href: "/placements", label: "Placements", icon: <Handshake /> });
    nav.push({ href: "/courses", label: "Academy", icon: <GraduationCap /> });
  }
  if (actor.role === "CLIENT") {
    nav.push({ href: "/talent", label: "Find talent", icon: <Search /> });
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
  if (can(actor, "interview.read_all")) nav.push({ href: "/staff/interviews", label: "Interview requests", icon: <CalendarClock /> });
  if (can(actor, "placement.read_all")) nav.push({ href: "/staff/placements", label: "Placements", icon: <Handshake /> });
  if (can(actor, "reservation.manage")) nav.push({ href: "/staff/reservations", label: "Reservations", icon: <Lock /> });
  if (can(actor, "billing_rate.approve") || can(actor, "invoice.manage") || can(actor, "deposit.read")) nav.push({ href: "/staff/commercial", label: "Commercial", icon: <Receipt /> });
  if (can(actor, "report.revenue") || can(actor, "report.pipeline")) nav.push({ href: "/staff/reports", label: "Reports", icon: <BarChart3 /> });
  if (can(actor, "report.talent") || can(actor, "report.pipeline") || can(actor, "report.academy") || can(actor, "client.read")) nav.push({ href: "/staff/analytics", label: "Analytics", icon: <LineChart /> });
  if (can(actor, "user.manage")) nav.push({ href: "/staff/users", label: "Users", icon: <UserCog /> });
  if (can(actor, "interview.coordinate") || can(actor, "flag.review")) nav.push({ href: "/staff/compliance", label: "Compliance", icon: <ShieldAlert /> });
  if (actor.role === "AGENT" || actor.role === "CLIENT") nav.push({ href: "/account/agreements", label: "Agreements", icon: <FileSignature /> });
  nav.push({ href: "/notifications", label: "Notifications", icon: <Bell /> });
  if (can(actor, "course.create_own") || can(actor, "course.manage")) nav.splice(1, 0, { href: "/coach", label: "Coach console", icon: <GraduationCap /> });
  if (can(actor, "course.manage") || can(actor, "course.payment.record") || can(actor, "certification.review")) nav.splice(nav.findIndex((n) => n.href === "/notifications"), 0, { href: "/staff/academy", label: "Academy admin", icon: <Award /> });

  const unread = (await notificationRepository.listForUser(prisma, actor.userId, 50)).filter((n) => !n.readAt).length;

  return (
    <AppShell nav={nav} email={auth.email} roleLabel={ROLE_NAMES[actor.role].name} unread={unread} onLogout={logoutAction}>
      {children}
    </AppShell>
  );
}
