import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertAgencyScope, requireActiveAgency } from "@/server/policies/ownership";
import { membershipRepository } from "@/server/repositories/membership.repository";
import { agencyRepository } from "@/server/repositories/agency.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { audit } from "@/server/audit/audit";
import { randomToken } from "@/server/auth/crypto";
import { sendEmailNow } from "@/server/jobs/mailer";
import { templates } from "@/server/notifications/templates";
import { getEnv } from "@/server/env";
import { getSetting } from "@/server/services/setting.service";
import { seatTotals, joinAgencyTx, SeatCapacityError } from "@/server/services/seat.service";
import { registerAgent, type AgentRegistrationInput } from "@/server/services/agent.service";
import { normalizeEmail } from "@/server/services/identity.service";
import { toEmailInviteView, toInviteLinkView, toJoinPageView, toMemberView, type JoinPageView } from "@/server/views/invite.views";

/**
 * Invitations (v2 phase 2): the agency's unique sign-up link and email invites. Both end in the same join path,
 * which runs duplicate detection, the terms checkbox, and the seat capacity check before anything is created.
 */

function appUrl(): string {
  try {
    return getEnv().APP_URL.replace(/\/$/, "");
  } catch {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }
}

// ---------------------------------------------------------------------------
// The unique link
// ---------------------------------------------------------------------------

export async function inviteLinkForAgency(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.team.invite");
  const agencyId = actor.agency?.id;
  if (!agencyId) throw new ForbiddenError("You are not a member of an agency");
  const agency = await agencyRepository.findAgency(db, agencyId);
  if (!agency) throw new NotFoundError();
  let link = await membershipRepository.activeLink(db, agencyId);
  if (!link) {
    const settings = await getSetting(db, "agencySeats");
    link = await membershipRepository.createLink(db, { agencyId, token: randomToken(24), label: `Join ${agency.name} on Hirewise Connect`, createdById: actor.userId, expiresAt: settings.inviteLinkTtlDays > 0 ? new Date(Date.now() + settings.inviteLinkTtlDays * 24 * 60 * 60_000) : null });
  }
  return toInviteLinkView(link, appUrl());
}

export async function rotateInviteLink(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.team.invite");
  const agencyId = requireActiveAgency(actor);
  const agency = await agencyRepository.findAgency(db, agencyId);
  if (!agency) throw new NotFoundError();
  const settings = await getSetting(db, "agencySeats");
  const link = await db.$transaction(async (tx) => {
    await membershipRepository.deactivateLinks(tx, agencyId);
    const l = await membershipRepository.createLink(tx, { agencyId, token: randomToken(24), label: `Join ${agency.name} on Hirewise Connect`, createdById: actor.userId, expiresAt: settings.inviteLinkTtlDays > 0 ? new Date(Date.now() + settings.inviteLinkTtlDays * 24 * 60 * 60_000) : null });
    await audit(tx, { actor, action: "AGENCY_INVITE_LINK_ROTATED", entityType: "AgencyInviteLink", entityId: l.id, newValue: { agencyId } });
    return l;
  });
  return toInviteLinkView(link, appUrl());
}

// ---------------------------------------------------------------------------
// Email invites
// ---------------------------------------------------------------------------

export const emailInvitesSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses, one per line.")).min(1, "Enter at least one email address.").max(50),
});

export async function sendEmailInvites(db: PrismaClient, actor: Actor, raw: z.input<typeof emailInvitesSchema>) {
  authorize(actor, "agency.team.invite");
  const agencyId = requireActiveAgency(actor);
  const input = emailInvitesSchema.parse(raw);
  const agency = await agencyRepository.findAgency(db, agencyId);
  if (!agency) throw new NotFoundError();
  if (!agency.planId) throw new ForbiddenError("No plan is assigned to your agency yet. Ask Hirewise to set one; invites open after that.");
  const emails = [...new Set(input.emails.map(normalizeEmail))];
  const [totals, open] = await Promise.all([seatTotals(db, agencyId), membershipRepository.openInviteCount(db, agencyId)]);
  if (totals.available - open < emails.length) throw new SeatCapacityError(`No Available Agent Seats for ${emails.length} invite(s): ${totals.available} available, ${open} already reserved by open invites. Add more seats first.`);
  const settings = await getSetting(db, "agencySeats");
  const sent: string[] = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  for (const email of emails) {
    if (await membershipRepository.openInviteForEmail(db, agencyId, email)) {
      skipped.push({ email, reason: "already invited" });
      continue;
    }
    const token = randomToken(24);
    const invite = await db.$transaction(async (tx) => {
      const i = await membershipRepository.createEmailInvite(tx, { agencyId, email, token, invitedById: actor.userId, expiresAt: new Date(Date.now() + settings.emailInviteTtlDays * 24 * 60 * 60_000) });
      await audit(tx, { actor, action: "AGENCY_EMAIL_INVITE_SENT", entityType: "AgencyEmailInvite", entityId: i.id, newValue: { agencyId, email } });
      return i;
    });
    try {
      await sendEmailNow(db, { kind: "agency_invite", to: email, ...templates.agencyInvite(`${appUrl()}/join/${token}`, agency.name, settings.emailInviteTtlDays) });
      sent.push(email);
    } catch (err) {
      skipped.push({ email, reason: err instanceof Error ? err.message : "email could not be sent" });
      await membershipRepository.updateEmailInvite(db, invite.id, { status: "REVOKED" });
    }
  }
  return { sent, skipped };
}

export async function revokeEmailInvite(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "agency.team.invite");
  const invite = await membershipRepository.findEmailInvite(db, id);
  if (!invite) throw new NotFoundError();
  assertAgencyScope(actor, invite.agencyId);
  if (invite.status !== "PENDING") throw new ForbiddenError("Only pending invites can be revoked.");
  await db.$transaction(async (tx) => {
    await membershipRepository.updateEmailInvite(tx, id, { status: "REVOKED" });
    await audit(tx, { actor, action: "AGENCY_EMAIL_INVITE_REVOKED", entityType: "AgencyEmailInvite", entityId: id, newValue: { agencyId: invite.agencyId, email: invite.email } });
  });
}

export async function listEmailInvites(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.team.read");
  const agencyId = actor.agency?.id;
  if (!agencyId) throw new ForbiddenError("You are not a member of an agency");
  return (await membershipRepository.listEmailInvites(db, agencyId, undefined, 50)).map(toEmailInviteView);
}

export async function expireEmailInvites(db: PrismaClient, now = new Date()): Promise<number> {
  return (await membershipRepository.expireEmailInvites(db, now)).count;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

type Resolved = { kind: "LINK" | "EMAIL"; agency: { id: string; name: string; status: string; planId: string | null }; label: string; email: string | null; linkId: string | null; emailInviteId: string | null; invalid: string | null };

async function resolveToken(db: PrismaClient, token: string): Promise<Resolved | null> {
  const link = await membershipRepository.findLinkByToken(db, token);
  if (link) {
    const invalid = !link.active ? "This invitation link was replaced by a newer one." : link.expiresAt && link.expiresAt.getTime() < Date.now() ? "This invitation link has expired." : null;
    return { kind: "LINK", agency: link.agency, label: link.label, email: null, linkId: link.id, emailInviteId: null, invalid };
  }
  const invite = await membershipRepository.findEmailInviteByToken(db, token);
  if (invite) {
    const invalid = invite.status === "ACCEPTED" ? "This invitation was already used." : invite.status === "REVOKED" ? "This invitation was withdrawn by the agency." : invite.status === "EXPIRED" || invite.expiresAt.getTime() < Date.now() ? "This invitation has expired." : null;
    return { kind: "EMAIL", agency: invite.agency, label: `Join ${invite.agency.name} on Hirewise Connect`, email: invite.email, linkId: null, emailInviteId: invite.id, invalid };
  }
  return null;
}

/** Whether a join may proceed right now, and if not, the message the page shows. */
async function acceptance(db: PrismaClient, r: Resolved): Promise<{ accepting: boolean; reason: string | null }> {
  if (r.invalid) return { accepting: false, reason: r.invalid };
  if (r.agency.status !== "ACTIVE") return { accepting: false, reason: "This agency is not accepting new members right now." };
  if (!r.agency.planId) return { accepting: false, reason: "This agency is not set up for new members yet. Ask the agency to contact Hirewise." };
  const totals = await seatTotals(db, r.agency.id);
  if (totals.available < 1) return { accepting: false, reason: "No Available Agent Seats. The agency needs to add seats before you can join." };
  return { accepting: true, reason: null };
}

/** The public join page. Shows the agency name and label only; nothing else about the agency. */
export async function joinPageInfo(db: PrismaClient, token: string): Promise<JoinPageView | null> {
  const r = await resolveToken(db, token);
  if (!r) return null;
  const a = await acceptance(db, r);
  return toJoinPageView({ kind: r.kind, agencyName: r.agency.name, label: r.label, accepting: a.accepting, reason: a.reason, email: r.email });
}

/** A signed-in talent account joins with one click. Nothing about them changes except the membership. */
export async function joinAsExistingUser(db: PrismaClient, actor: Actor, token: string, meta: RequestMeta) {
  const r = await resolveToken(db, token);
  if (!r) throw new NotFoundError("Invitation not found");
  const a = await acceptance(db, r);
  if (!a.accepting) throw new ForbiddenError(a.reason ?? "This invitation cannot be used.");
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent accounts can join an agency. Sign out and create a talent account from this link, or sign in with your talent account.");
  const flags = await userRepository.authFlags(db, actor.userId);
  if (!flags) throw new NotFoundError();
  if (r.email && normalizeEmail(r.email) !== normalizeEmail(flags.email)) throw new ForbiddenError(`This invitation was sent to ${r.email}. Sign in with that account, or ask the agency to invite ${flags.email}.`);
  const member = await db.$transaction(async (tx) => {
    const m = await joinAgencyTx(tx, actor, { agencyId: r.agency.id, agentProfileId: actor.agentProfileId!, platformIdentityId: actor.identityId ?? null, status: flags.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION", source: r.kind === "EMAIL" ? "EMAIL_INVITE" : "UNIQUE_LINK", invitedEmail: r.email, approvedById: null, emailInviteId: r.emailInviteId, linkId: r.linkId });
    await audit(tx, { actor, action: "AGENCY_MEMBER_JOINED", entityType: "AgencyMembership", entityId: m.id, newValue: { agencyId: r.agency.id, how: "existing-account" }, ipAddress: meta.ipAddress ?? undefined });
    return m;
  });
  return toMemberView(member);
}

/** A new talent account created from the invitation: the normal registration plus the membership, in one transaction. */
export async function registerViaInvite(db: PrismaClient, input: AgentRegistrationInput, token: string, meta: RequestMeta) {
  const r = await resolveToken(db, token);
  if (!r) throw new NotFoundError("Invitation not found");
  const a = await acceptance(db, r);
  if (!a.accepting) throw new ForbiddenError(a.reason ?? "This invitation cannot be used.");
  if (r.email && normalizeEmail(r.email) !== normalizeEmail(input.email)) throw Object.assign(new Error(`This invitation was sent to ${r.email}. Use that email address.`), { name: "RegistrationError", field: "email" });
  return registerAgent(db, input, meta, { agencyId: r.agency.id, source: r.kind === "EMAIL" ? "EMAIL_INVITE" : "UNIQUE_LINK", emailInviteId: r.emailInviteId, linkId: r.linkId, invitedEmail: r.email });
}
