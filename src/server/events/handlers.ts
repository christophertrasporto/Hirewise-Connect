import type { Db } from "@/server/db/types";
import type { DomainEventMap, DomainEventType } from "./events";
import { notifyUser } from "@/server/services/notification.service";
import { userRepository } from "@/server/repositories/user.repository";
import { taskRepository } from "@/server/repositories/task.repository";

export type EventHandler<T extends DomainEventType> = (db: Db, payload: DomainEventMap[T]) => Promise<void>;

async function notifyStaff(db: Db, roles: Array<"SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "OPERATIONS">, n: { type: string; title: string; body: string; dedupeKey: string; email?: boolean }) {
  const staff = await userRepository.idsByRole(db, roles);
  for (const s of staff) {
    await notifyUser(db, { userId: s.id, type: n.type, title: n.title, body: n.body, dedupeKey: `${n.dedupeKey}:${s.id}`, email: n.email ? { to: s.email } : undefined });
  }
}

/**
 * Event → side-effects (Section 9). Handlers must be idempotent: the worker may
 * retry an event if the process dies after the handler but before markProcessed.
 */
export const EVENT_HANDLERS: { [T in DomainEventType]: EventHandler<T> } = {
  USER_CREATED: async (db, p) => {
    await notifyUser(db, {
      userId: p.userId,
      type: "WELCOME",
      title: "Welcome to Hirewise Connect",
      body: "Your account has been created. Complete the required agreements to continue.",
      email: { to: p.email },
      dedupeKey: `WELCOME:${p.userId}`,
    });
  },

  SETTING_CHANGED: async () => {},

  CLIENT_REGISTERED: async (db, p) => {
    await notifyStaff(db, ["SALES", "ADMIN"], {
      type: "NEW_CLIENT_REGISTRATION",
      title: `New client registration: ${p.companyName}`,
      body: "Review the requirement and activate the account so the client can browse talent.",
      dedupeKey: `NEW_CLIENT:${p.clientId}`,
      email: true,
    });
    const existing = await taskRepository.findOpenByRelated(db, "QUALIFY_CLIENT", "Client", p.clientId);
    if (!existing) {
      await taskRepository.create(db, { type: "QUALIFY_CLIENT", title: `Qualify and activate ${p.companyName}`, queueRole: "SALES", dueAt: new Date(Date.now() + 24 * 60 * 60_000), relatedType: "Client", relatedId: p.clientId });
    }
  },

  CLIENT_ACTIVATED: async (db, p) => {
    await notifyUser(db, {
      userId: p.userId,
      type: "CLIENT_ACTIVATED",
      title: "Your Hirewise Connect account is active",
      body: `${p.companyName} can now browse verified talent, shortlist candidates, and request interviews.`,
      email: { to: p.email },
      dedupeKey: `CLIENT_ACTIVATED:${p.clientId}`,
    });
    await taskRepository.completeByRelated(db, "QUALIFY_CLIENT", "Client", p.clientId);
  },

  AGENT_REGISTERED: async (db, p) => {
    await notifyStaff(db, ["RECRUITER"], {
      type: "NEW_AGENT_REGISTRATION",
      title: `New talent registration: ${p.displayName}`,
      body: "The agent is completing their profile. You will be notified when it is submitted for review.",
      dedupeKey: `NEW_AGENT:${p.agentProfileId}`,
    });
  },

  PROFILE_SUBMITTED: async (db, p) => {
    await notifyStaff(db, ["RECRUITER", "ADMIN"], {
      type: "PROFILE_SUBMITTED",
      title: `Profile submitted for review: ${p.displayName}`,
      body: "Open the recruiter queue to review the profile, résumé, and media.",
      dedupeKey: `PROFILE_SUBMITTED:${p.agentProfileId}`,
      email: true,
    });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_PROFILE", "AgentProfile", p.agentProfileId);
    if (!existing) {
      await taskRepository.create(db, { type: "REVIEW_PROFILE", title: `Review profile: ${p.displayName}`, queueRole: "RECRUITER", dueAt: new Date(Date.now() + 2 * 24 * 60 * 60_000), relatedType: "AgentProfile", relatedId: p.agentProfileId });
    }
  },

  MEDIA_REVIEWED: async (db, p) => {
    const label = p.type === "VIDEO" ? "video introduction" : `voice sample “${p.title}”`;
    const copy = {
      APPROVED: { title: `Your ${label} is approved`, body: "Clients can now see it on your profile." },
      REVISION_REQUIRED: { title: `Your ${label} needs changes`, body: p.feedback ? `Hirewise feedback: ${p.feedback}` : "Hirewise requested changes." },
      REJECTED: { title: `Your ${label} was not approved`, body: p.feedback ? `Hirewise feedback: ${p.feedback}` : "Upload a new one when you are ready." },
    }[p.outcome];
    await notifyUser(db, { userId: p.userId, type: `MEDIA_${p.outcome}`, title: copy.title, body: copy.body, email: { to: p.email }, dedupeKey: `MEDIA_${p.outcome}:${p.mediaId}` });
  },

  CANDIDATE_SHORTLISTED: async (db, p) => {
    // Daily digest per account manager (Section 9): one notification per client per day.
    const day = new Date().toISOString().slice(0, 10);
    const recipients = p.accountManagerUserId ? [{ id: p.accountManagerUserId }] : await userRepository.idsByRole(db, ["SALES"]);
    for (const r of recipients) {
      await notifyUser(db, { userId: r.id, type: "CANDIDATE_SHORTLISTED", title: `${p.companyName} is shortlisting talent`, body: `Latest: ${p.displayName}. Open the shortlist activity view for details.`, dedupeKey: `SHORTLIST:${p.clientId}:${day}` });
    }
  },

  INTERVIEW_REQUESTED: async (db, p) => {
    const body = `${p.companyName} requested interviews with ${p.candidateCount} candidate(s) for ${p.role}. Review the request and propose times.`;
    if (p.accountManagerUserId) {
      const am = await userRepository.authFlags(db, p.accountManagerUserId);
      await notifyUser(db, { userId: p.accountManagerUserId, type: "INTERVIEW_REQUESTED", title: `Interview request from ${p.companyName}`, body, dedupeKey: `IR:${p.requestId}:am`, email: am ? { to: am.email } : undefined });
    } else {
      await notifyStaff(db, ["SALES"], { type: "INTERVIEW_REQUESTED", title: `Interview request from ${p.companyName}`, body, dedupeKey: `IR:${p.requestId}`, email: true });
    }
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_INTERVIEW_REQUEST", "InterviewRequest", p.requestId);
    if (!existing) await taskRepository.create(db, { type: "REVIEW_INTERVIEW_REQUEST", title: `Coordinate interviews for ${p.companyName} (${p.role})`, queueRole: p.accountManagerUserId ? undefined : "SALES", assigneeUserId: p.accountManagerUserId, dueAt: new Date(Date.now() + 24 * 60 * 60_000), relatedType: "InterviewRequest", relatedId: p.requestId });
  },

  INTERVIEW_SLOTS_PROPOSED: async (db, p) => {
    await notifyUser(db, { userId: p.userId, type: "INTERVIEW_SLOTS_PROPOSED", title: "Hirewise proposed interview times", body: `Open your ${p.role} interview request to confirm the proposed times.`, email: { to: p.email }, dedupeKey: `SLOTS:${p.requestId}:${Date.now() >> 16}` });
  },

  CLIENT_CONFIRMED_SLOTS: async (db, p) => {
    await notifyUser(db, { userId: p.salesUserId, type: "CLIENT_CONFIRMED_SLOTS", title: `${p.companyName} confirmed interview times`, body: "Candidates have been asked to confirm. Schedule once they respond.", dedupeKey: `CONF:${p.requestId}:${Date.now() >> 16}` });
  },

  CANDIDATE_CONFIRMATION_REQUESTED: async (db, p) => {
    await notifyUser(db, { userId: p.userId, type: "CANDIDATE_CONFIRMATION_REQUESTED", title: "A client would like to interview you", body: `Role: ${p.role}${p.schedule ? ` - Schedule: ${p.schedule}` : ""} - Timezone: ${p.timezone}. Open Interviews to confirm your availability. The company is shared once the interview is scheduled.`, email: { to: p.email }, dedupeKey: `CCR:${p.requestId}:${p.agentProfileId}:${Date.now() >> 16}` });
  },

  CANDIDATE_RESPONDED: async (db, p) => {
    await notifyUser(db, { userId: p.salesUserId, type: "CANDIDATE_RESPONDED", title: `${p.displayName} ${p.response === "CONFIRMED" ? "confirmed" : "declined"} the interview`, body: "Open the request to schedule or adjust candidates.", dedupeKey: `CR:${p.requestId}:${p.displayName}:${p.response}` });
  },

  INTERVIEW_SCHEDULED: async (db, p) => {
    const when = new Date(p.scheduledAt).toLocaleString("en-US", { timeZone: p.timezone, dateStyle: "medium", timeStyle: "short" });
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "INTERVIEW_SCHEDULED", title: `Interview scheduled with ${p.displayName}`, body: `${when} (${p.timezone}).${p.meetingLink ? ` Link: ${p.meetingLink}` : ""}`, email: p.clientEmail ? { to: p.clientEmail } : undefined, dedupeKey: `IS:${p.interviewId}:client` });
    await notifyUser(db, { userId: p.agentUserId, type: "INTERVIEW_SCHEDULED", title: `Interview scheduled with ${p.companyName}`, body: `${when} (${p.timezone}).${p.meetingLink ? ` Link: ${p.meetingLink}` : ""} Join a few minutes early.`, email: { to: p.agentEmail }, dedupeKey: `IS:${p.interviewId}:agent` });
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "INTERVIEW_SCHEDULED", title: `Scheduled: ${p.displayName} with ${p.companyName}`, body: `${when} (${p.timezone}).`, dedupeKey: `IS:${p.interviewId}:sales` });
  },

  CLIENT_DECISION_REQUESTED: async (db, p) => {
    await notifyUser(db, { userId: p.userId, type: "CLIENT_DECISION_REQUESTED", title: "Interviews complete: record your decision", body: `Mark each ${p.role} candidate as Interested, Second interview, Selected, or Not selected.`, email: { to: p.email }, dedupeKey: `CDR:${p.requestId}` });
  },

  CANDIDATE_SELECTED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "CANDIDATE_SELECTED", title: `${p.companyName} selected you`, body: "Congratulations. Hirewise will confirm the commercial terms with the client and prepare your deployment. You are reserved for this client meanwhile.", email: { to: p.agentEmail }, dedupeKey: `SEL:${p.placementId}:agent` });
    const staff = await userRepository.idsByRole(db, ["ADMIN", "OPERATIONS"]);
    const recipients = [...staff.map((s) => s.id), ...(p.salesUserId ? [p.salesUserId] : [])];
    for (const id of new Set(recipients)) {
      await notifyUser(db, { userId: id, type: "CANDIDATE_SELECTED", title: `${p.companyName} selected ${p.displayName}`, body: "A placement record was created. Next: Hirewise approval, agreement, and deposit (Phase 4).", dedupeKey: `SEL:${p.placementId}:${id}` });
    }
    const existing = await taskRepository.findOpenByRelated(db, "FINALISE_PLACEMENT", "Placement", p.placementId);
    if (!existing) await taskRepository.create(db, { type: "FINALISE_PLACEMENT", title: `Finalise terms: ${p.displayName} for ${p.companyName}`, assigneeUserId: p.salesUserId, queueRole: p.salesUserId ? undefined : "SALES", dueAt: new Date(Date.now() + 2 * 24 * 60 * 60_000), relatedType: "Placement", relatedId: p.placementId });
  },

  CANDIDATE_NOT_SELECTED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "CANDIDATE_NOT_SELECTED", title: "Interview outcome", body: `The client did not select you for the ${p.role} role this time. Your profile stays live for other clients.`, email: { to: p.agentEmail }, dedupeKey: `NSEL:${p.requestId}:${p.agentUserId}` });
  },

  SECOND_INTERVIEW_REQUESTED: async (db, p) => {
    await notifyUser(db, { userId: p.salesUserId, type: "SECOND_INTERVIEW_REQUESTED", title: `${p.companyName} wants a second interview with ${p.displayName}`, body: "Propose new times to the client.", dedupeKey: `SI:${p.requestId}:${p.displayName}:${Date.now() >> 16}` });
  },

  INTERVIEW_REQUEST_CANCELLED: async (db, p) => {
    const body = `The ${p.role} interview request from ${p.companyName} was cancelled${p.byRole === "CLIENT" ? " by the client" : " by Hirewise"}.`;
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "INTERVIEW_REQUEST_CANCELLED", title: "Interview request cancelled", body, dedupeKey: `IRC:${p.requestId}:sales` });
    if (p.clientUserId && p.byRole !== "CLIENT") await notifyUser(db, { userId: p.clientUserId, type: "INTERVIEW_REQUEST_CANCELLED", title: "Interview request cancelled", body, dedupeKey: `IRC:${p.requestId}:client` });
    for (const id of p.agentUserIds) await notifyUser(db, { userId: id, type: "INTERVIEW_REQUEST_CANCELLED", title: "An interview request was cancelled", body: `The ${p.role} interview request is no longer active.`, dedupeKey: `IRC:${p.requestId}:${id}` });
    await taskRepository.completeByRelated(db, "REVIEW_INTERVIEW_REQUEST", "InterviewRequest", p.requestId);
  },

  MESSAGE_POSTED: async (db, p) => {
    const recipients = new Set<string>();
    if (p.authorRole !== "CLIENT" && p.clientUserId && (p.visibleTo === "ALL" || p.visibleTo === "CLIENT_AND_HIREWISE")) recipients.add(p.clientUserId);
    if (p.authorRole !== "AGENT" && (p.visibleTo === "ALL" || p.visibleTo === "AGENT_AND_HIREWISE")) p.agentUserIds.forEach((id) => recipients.add(id));
    if (["CLIENT", "AGENT"].includes(p.authorRole) && p.salesUserId) recipients.add(p.salesUserId);
    for (const id of recipients) await notifyUser(db, { userId: id, type: "MESSAGE_POSTED", title: "New message on an interview request", body: p.preview, dedupeKey: `MSG:${p.messageId}:${id}` });
  },

  MESSAGE_HELD_FOR_REVIEW: async (db, p) => {
    const body = `A ${p.authorRole.toLowerCase()} message was held: ${p.reasons.join(", ")}. Review it before it reaches the other party.`;
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "MESSAGE_HELD_FOR_REVIEW", title: "Message held for review", body, dedupeKey: `HELD:${p.messageId}` });
    else await notifyStaff(db, ["SALES"], { type: "MESSAGE_HELD_FOR_REVIEW", title: "Message held for review", body, dedupeKey: `HELD:${p.messageId}` });
  },

  RESERVATION_EXPIRING: async (db, p) => {
    await notifyUser(db, { userId: p.reservedById, type: "RESERVATION_EXPIRING", title: `Reservation for ${p.displayName} expires soon`, body: `Held for ${p.companyName} until ${new Date(p.expiresAt).toLocaleString()}. Extend it if the deal is still live.`, dedupeKey: `REXP:${p.reservationId}:${p.expiresAt.slice(0, 10)}` });
  },

  RESERVATION_EXPIRED: async (db, p) => {
    await notifyUser(db, { userId: p.reservedById, type: "RESERVATION_EXPIRED", title: `Reservation for ${p.displayName} expired`, body: `${p.displayName} is no longer held for ${p.companyName} and is visible to other clients again.`, dedupeKey: `REXPD:${p.reservationId}` });
  },

  PROFILE_REVIEWED: async (db, p) => {
    const copy = {
      APPROVED: { title: "Your profile is approved", body: "Your Hirewise Connect profile is now visible to vetted clients. Keep your availability up to date." },
      REVISION_REQUIRED: { title: "Your profile needs changes", body: p.feedback ? `Hirewise feedback: ${p.feedback}` : "Hirewise has requested changes. Open your profile to see the feedback." },
      REJECTED: { title: "Profile review outcome", body: p.feedback ? `Hirewise decision: ${p.feedback}` : "Your profile was not approved at this time." },
    }[p.outcome];
    await notifyUser(db, { userId: p.userId, type: `PROFILE_${p.outcome}`, title: copy.title, body: copy.body, email: { to: p.email }, dedupeKey: `PROFILE_${p.outcome}:${p.agentProfileId}:${Date.now() >> 20}` });
    if (p.outcome !== "REVISION_REQUIRED") await taskRepository.completeByRelated(db, "REVIEW_PROFILE", "AgentProfile", p.agentProfileId);
  },

  // Phase 3 — Academy
  COURSE_SUBMITTED_FOR_APPROVAL: async (db, p) => {
    const price = p.priceCents === 0 ? "free" : `USD ${(p.priceCents / 100).toFixed(2)}`;
    await notifyStaff(db, ["ADMIN"], { type: "COURSE_SUBMITTED", title: `Course ready for publishing: ${p.title}`, body: `A coach submitted "${p.title}" (${price}). Review the syllabus and exam, link a certification template, and publish.`, dedupeKey: `COURSE_SUBMITTED:${p.courseId}:${Date.now() >> 16}`, email: true });
    const existing = await taskRepository.findOpenByRelated(db, "PUBLISH_COURSE", "AcademyCourse", p.courseId);
    if (!existing) await taskRepository.create(db, { type: "PUBLISH_COURSE", title: `Review and publish course: ${p.title}`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), relatedType: "AcademyCourse", relatedId: p.courseId });
  },

  COURSE_PUBLISHED: async (db, p) => {
    await notifyUser(db, { userId: p.coachUserId, type: "COURSE_PUBLISHED", title: `"${p.title}" is live`, body: "Talent can now enrol. You will be notified as students complete the exam.", dedupeKey: `COURSE_PUBLISHED:${p.courseId}` });
    await taskRepository.completeByRelated(db, "PUBLISH_COURSE", "AcademyCourse", p.courseId);
  },

  COURSE_ENROLLED: async (db, p) => {
    for (const id of new Set(p.coachUserIds)) await notifyUser(db, { userId: id, type: "COURSE_ENROLLED", title: `New student in ${p.title}`, body: p.paymentRequired ? "Enrolment is pending payment; the course unlocks once Hirewise records it." : "The student can start the course now.", dedupeKey: `ENROL:${p.courseId}:${p.agentProfileId}:${id}` });
    if (p.paymentRequired) {
      await notifyStaff(db, ["SALES", "ADMIN"], { type: "COURSE_PAYMENT_PENDING", title: `Course payment pending: ${p.title}`, body: `A student enrolled in a paid course (USD ${(p.priceCents / 100).toFixed(2)}). Record the payment under Staff > Academy once received.`, dedupeKey: `CPAY:${p.courseId}:${p.agentProfileId}` });
    }
  },

  COURSE_PAYMENT_RECORDED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "COURSE_PAYMENT_RECORDED", title: `${p.courseTitle} is unlocked`, body: p.waived ? "Hirewise waived the course fee. You can start the course now." : "Your payment was recorded. You can start the course and take the exam.", email: { to: p.agentEmail }, dedupeKey: `CPAID:${p.enrollmentId}` });
  },

  // Identity phase 1
  DUPLICATE_FLAG_RAISED: async (db, p) => {
    await notifyStaff(db, ["SUPER_ADMIN", "ADMIN"], { type: "DUPLICATE_FLAG_RAISED", title: `Duplicate sign-up flagged: ${p.attemptedEmail}`, body: `${p.attemptedName} tried to sign up (${p.kind.toLowerCase().replace(/_/g, " ")}) and matched an existing identity: ${p.matchReasons.join(", ")}. Review it under Identity.`, dedupeKey: `DUPFLAG:${p.flagId}` });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_DUPLICATE_FLAG", "DuplicateFlag", p.flagId);
    if (!existing) await taskRepository.create(db, { type: "REVIEW_DUPLICATE_FLAG", title: `Review duplicate sign-up: ${p.attemptedEmail}`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 2 * 24 * 60 * 60_000), relatedType: "DuplicateFlag", relatedId: p.flagId });
    if (p.notifyExisting && p.matchedUserId && p.matchedEmail) {
      await notifyUser(db, { userId: p.matchedUserId, type: "DUPLICATE_SIGNUP_ATTEMPT", title: "Someone tried to sign up with your details", body: "A new Hirewise Connect sign-up matched your email or phone number. If it was you, sign in to your existing account instead. If not, no action is needed: Hirewise is reviewing it.", email: { to: p.matchedEmail }, dedupeKey: `DUPNOTIFY:${p.flagId}` });
    }
  },
  DUPLICATE_FLAG_DECIDED: async (db, p) => {
    await taskRepository.completeByRelated(db, "REVIEW_DUPLICATE_FLAG", "DuplicateFlag", p.flagId);
    if (p.decision === "LINKED" && p.matchedEmail) {
      const existing = await userRepository.findByEmail(db, p.matchedEmail);
      if (existing) await notifyUser(db, { userId: existing.id, type: "DUPLICATE_SIGNUP_LINKED", title: "Use your existing Hirewise Connect account", body: "Hirewise reviewed a recent sign-up that matched your details and linked it to this account. Sign in with this email; use \"Forgot password\" if you need a new password.", email: { to: p.matchedEmail }, dedupeKey: `DUPLINK:${p.flagId}` });
    }
  },
  TERMS_VERSION_PUBLISHED: async (db, p) => {
    if (!p.material || !p.requiresReacceptance) return;
    const users = await userRepository.idsByRole(db, p.roles as Parameters<typeof userRepository.idsByRole>[1]);
    for (const u of users) {
      await notifyUser(db, { userId: u.id, type: "TERMS_UPDATED", title: `Updated: ${p.title}`, body: `Hirewise published version ${p.version}. You will be asked to accept it the next time you sign in.`, email: { to: u.email }, dedupeKey: `TERMS:${p.agreementId}:${u.id}` });
    }
  },
  // v2 phase 2: Agent Seats and invitations
  AGENCY_MEMBER_JOINED: async (db, p) => {
    await notifyUser(db, { userId: p.ownerUserId, type: "AGENCY_MEMBER_JOINED", title: `${p.displayName} joined ${p.agencyName}`, body: p.status === "ACTIVE" ? "They are an active member and hold one Agent Seat." : "They hold one Agent Seat and become active once they verify their email.", dedupeKey: `JOIN:${p.membershipId}` });
  },
  AGENCY_SEATS_CHANGED: async (db, p) => {
    if (p.changeType === "CONSUMED" || p.changeType === "RELEASED") return;
    await notifyUser(db, { userId: p.ownerUserId, type: "AGENCY_SEATS_CHANGED", title: `Agent Seats updated for ${p.agencyName}`, body: `${p.reason}. You now have ${p.total} seat(s), ${p.available} available.`, email: { to: p.ownerEmail }, dedupeKey: `SEATS:${p.agencyId}:${p.changeType}:${p.quantity}:${p.total}:${Date.now()}` });
  },
  SEAT_REQUEST_SUBMITTED: async (db, p) => {
    await notifyStaff(db, ["SUPER_ADMIN", "ADMIN"], { type: "SEAT_REQUEST_SUBMITTED", title: `${p.agencyName} requests ${p.requestedSeats} Agent Seat(s)`, body: p.note ?? "Review it under Agencies → Seat requests.", dedupeKey: `SEATREQ:${p.requestId}` });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_SEAT_REQUEST", "SeatRequest", p.requestId);
    if (!existing) await taskRepository.create(db, { type: "REVIEW_SEAT_REQUEST", title: `Seat request: ${p.agencyName} (${p.requestedSeats})`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), relatedType: "SeatRequest", relatedId: p.requestId });
  },
  SEAT_REQUEST_DECIDED: async (db, p) => {
    await taskRepository.completeByRelated(db, "REVIEW_SEAT_REQUEST", "SeatRequest", p.requestId);
    await notifyUser(db, { userId: p.ownerUserId, type: "SEAT_REQUEST_DECIDED", title: p.decision === "APPROVED" ? `${p.grantedSeats} Agent Seat(s) added to ${p.agencyName}` : `Seat request for ${p.agencyName} was not approved`, body: `${p.note ?? (p.decision === "APPROVED" ? "Hirewise approved your request." : "Hirewise did not approve this request.")} You now have ${p.available} seat(s) available.`, email: { to: p.ownerEmail }, dedupeKey: `SEATDEC:${p.requestId}` });
  },
  SEAT_PURCHASE_CREATED: async (db, p) => {
    await notifyStaff(db, ["SUPER_ADMIN", "ADMIN"], { type: "SEAT_PURCHASE_CREATED", title: `${p.agencyName} wants to buy ${p.seatCount} Agent Seat(s)`, body: "Record the payment or waive it under Agencies → Purchases.", dedupeKey: `SEATBUY:${p.purchaseId}` });
    const existing = await taskRepository.findOpenByRelated(db, "RECORD_SEAT_PURCHASE", "SeatPurchase", p.purchaseId);
    if (!existing) await taskRepository.create(db, { type: "RECORD_SEAT_PURCHASE", title: `Seat purchase: ${p.agencyName} (${p.seatCount})`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), relatedType: "SeatPurchase", relatedId: p.purchaseId });
  },
  SEAT_PURCHASE_RECORDED: async (db, p) => {
    await taskRepository.completeByRelated(db, "RECORD_SEAT_PURCHASE", "SeatPurchase", p.purchaseId);
    await notifyUser(db, { userId: p.ownerUserId, type: "SEAT_PURCHASE_RECORDED", title: p.outcome === "CANCELLED" ? `Seat purchase for ${p.agencyName} was cancelled` : `${p.seatCount} Agent Seat(s) added to ${p.agencyName}`, body: p.outcome === "CANCELLED" ? "Hirewise cancelled this purchase. Contact Hirewise if this is unexpected." : `Hirewise recorded the purchase as ${p.outcome.toLowerCase()}. You now have ${p.available} seat(s) available.`, email: { to: p.ownerEmail }, dedupeKey: `SEATREC:${p.purchaseId}` });
  },
  // v2 phase 3: exits
  EXIT_REQUESTED: async (db, p) => {
    if (p.type === "AGENT_REQUESTED_LEAVE") {
      await notifyUser(db, { userId: p.ownerUserId, type: "EXIT_REQUESTED", title: `${p.displayName} asked to leave ${p.agencyName}`, body: `Reason: ${p.reason}. Review it under My team → Exit requests. Hirewise reviews it too when the agent has an active client assignment.`, dedupeKey: `EXITREQ:${p.exitRequestId}` });
    } else if (p.agentUserId) {
      await notifyUser(db, { userId: p.agentUserId, type: "EXIT_REQUESTED", title: `${p.agencyName} asked to end your membership`, body: `Reason: ${p.reason}. Timing: ${p.effectiveOption.toLowerCase().replace(/_/g, " ")}. Hirewise reviews the removal when you have an active client assignment.`, email: { to: p.agentEmail }, dedupeKey: `EXITREQ:${p.exitRequestId}` });
    }
  },
  EXIT_ESCALATED: async (db, p) => {
    await notifyStaff(db, ["SUPER_ADMIN", "ADMIN"], { type: "EXIT_ESCALATED", title: `Exit review needed: ${p.displayName} at ${p.agencyName}`, body: `${p.why}. Decide it under Agencies → Exit requests.`, dedupeKey: `EXITESC:${p.exitRequestId}` });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_EXIT_REQUEST", "ExitRequest", p.exitRequestId);
    if (!existing) await taskRepository.create(db, { type: "REVIEW_EXIT_REQUEST", title: `Exit review: ${p.displayName} (${p.agencyName})`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), relatedType: "ExitRequest", relatedId: p.exitRequestId });
  },
  EXIT_DECIDED: async (db, p) => {
    await taskRepository.completeByRelated(db, "REVIEW_EXIT_REQUEST", "ExitRequest", p.exitRequestId);
    const when = p.effectiveAt ? ` Effective ${new Date(p.effectiveAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.` : p.decision === "APPROVED" ? " Effective when the current assignment ends." : "";
    const byLabel = p.by === "ADMIN" ? "Hirewise" : p.by === "AGENCY" ? p.agencyName : p.displayName;
    if (p.agentUserId && p.by !== "AGENT") await notifyUser(db, { userId: p.agentUserId, type: "EXIT_DECIDED", title: p.decision === "APPROVED" ? `Your exit from ${p.agencyName} is approved` : `Your exit request was declined`, body: `${byLabel} ${p.decision === "APPROVED" ? "approved" : "declined"} the request.${p.note ? ` Note: ${p.note}.` : ""}${when}`, email: { to: p.agentEmail }, dedupeKey: `EXITDEC:${p.exitRequestId}:${p.decision}` });
    if (p.by !== "AGENCY") await notifyUser(db, { userId: p.ownerUserId, type: "EXIT_DECIDED", title: `${p.displayName}: exit ${p.decision.toLowerCase()}`, body: `${byLabel} ${p.decision === "APPROVED" ? "approved" : p.decision === "DECLINED" ? "declined" : "cancelled"} the request.${p.note ? ` Note: ${p.note}.` : ""}${when}`, dedupeKey: `EXITDECO:${p.exitRequestId}:${p.decision}` });
  },
  AGENCY_EXIT_COMPLETED: async (db, p) => {
    if (p.exitRequestId) await taskRepository.completeByRelated(db, "REVIEW_EXIT_REQUEST", "ExitRequest", p.exitRequestId);
    if (p.agentUserId) await notifyUser(db, { userId: p.agentUserId, type: "AGENCY_EXIT_COMPLETED", title: `Your membership of ${p.agencyName} has ended`, body: "Your profile is now a former agency profile. Agency-sponsored training and certifications stop counting for platform use; independent reapplication opens in the next phase.", dedupeKey: `EXITDONE:${p.membershipId}` });
    await notifyUser(db, { userId: p.ownerUserId, type: "AGENCY_EXIT_COMPLETED", title: `${p.displayName} left ${p.agencyName}`, body: `${p.reason}. Their Agent Seat is released per your seat release rule.`, dedupeKey: `EXITDONEO:${p.membershipId}` });
  },
  AGENCY_APPLICATION_SUBMITTED: async (db, p) => {
    await notifyStaff(db, ["SUPER_ADMIN", "ADMIN"], { type: "AGENCY_APPLICATION_SUBMITTED", title: `${p.resubmission ? "Updated" : "New"} agency application: ${p.agencyName}`, body: `${p.applicantName} ${p.resubmission ? "resubmitted their application" : "applied to run an agency"}. Review it under Agencies → Applications.`, dedupeKey: `AGAPP:${p.applicationId}:${p.resubmission ? "re" : "new"}` });
    const existing = await taskRepository.findOpenByRelated(db, "REVIEW_AGENCY_APPLICATION", "AgencyApplication", p.applicationId);
    if (!existing) await taskRepository.create(db, { type: "REVIEW_AGENCY_APPLICATION", title: `Review agency application: ${p.agencyName}`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), relatedType: "AgencyApplication", relatedId: p.applicationId });
  },
  AGENCY_APPLICATION_DECIDED: async (db, p) => {
    const copy = p.status === "APPROVED"
      ? { title: `Your agency ${p.agencyName} is approved`, body: `Welcome aboard. Your Agency Owner portal is ready: sign in and open "My agency".${p.message ? ` Message from Hirewise: ${p.message}` : ""}` }
      : p.status === "REJECTED"
        ? { title: `Your agency application was not approved`, body: p.message ?? "Hirewise did not approve the application." }
        : { title: `Hirewise needs more information about ${p.agencyName}`, body: `${p.message ?? "Please update your application."} Open your application to edit and resubmit it.` };
    await notifyUser(db, { userId: p.applicantUserId, type: `AGENCY_APPLICATION_${p.status}`, title: copy.title, body: copy.body, email: { to: p.applicantEmail }, dedupeKey: `AGDEC:${p.applicationId}:${p.status}:${Date.now()}` });
    if (p.status !== "NEEDS_MORE_INFO") await taskRepository.completeByRelated(db, "REVIEW_AGENCY_APPLICATION", "AgencyApplication", p.applicationId);
  },
  AGENCY_STATUS_CHANGED: async (db, p) => {
    await notifyUser(db, { userId: p.ownerUserId, type: "AGENCY_STATUS_CHANGED", title: `${p.agencyName} is now ${p.status.toLowerCase()}`, body: p.status === "ACTIVE" ? "Your agency is active again. Invites, training purchases, and submissions are available." : `Reason: ${p.reason}. Your data is kept; invites, purchases, and submissions are paused.`, email: { to: p.ownerEmail }, dedupeKey: `AGST:${p.agencyId}:${p.status}:${Date.now()}` });
  },
  ASSIGNMENT_SUBMITTED: async (db, p) => {
    for (const id of new Set(p.coachUserIds)) await notifyUser(db, { userId: id, type: "ASSIGNMENT_SUBMITTED", title: `${p.displayName} submitted ${p.lessonTitle}`, body: `${p.courseTitle}${p.resubmission ? " · new version" : ""}${p.late ? " · late" : ""}. Review it under Courses → Learners.`, dedupeKey: `ASUB:${p.submissionId}:${id}` });
  },
  ASSIGNMENT_REVIEWED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "ASSIGNMENT_REVIEWED", title: p.decision === "GRADED" ? `${p.lessonTitle} marked complete` : `${p.lessonTitle} returned for changes`, body: `${p.courseTitle}.${p.grade !== null ? ` Grade: ${p.grade}${p.maxPoints ? ` / ${p.maxPoints}` : ""}.` : ""}${p.feedback ? ` Feedback: ${p.feedback}` : ""}`, email: { to: p.agentEmail }, dedupeKey: `AREV:${p.submissionId}` });
  },
  ATTEMPT_PENDING_REVIEW: async (db, p) => {
    for (const id of new Set(p.coachUserIds)) await notifyUser(db, { userId: id, type: "ATTEMPT_PENDING_REVIEW", title: `${p.displayName} needs a mark on ${p.lessonTitle}`, body: `${p.courseTitle}. Written answers are waiting for your review under Courses → Learners.`, dedupeKey: `AREVQ:${p.attemptId}:${id}` });
  },
  COURSE_COMPLETED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "COURSE_COMPLETED", title: `You completed ${p.title}`, body: p.examScore !== null ? `Exam score: ${p.examScore}%. ${p.coachReviewRequired ? "Your coach will review your work before any certification is issued." : "Any linked certification is being processed."}` : "Your completion was recorded.", email: { to: p.agentEmail }, dedupeKey: `CCOMP:${p.courseId}:${p.agentProfileId}` });
    for (const id of new Set(p.coachUserIds)) await notifyUser(db, { userId: id, type: "STUDENT_COMPLETED", title: `${p.displayName} completed ${p.title}`, body: p.coachReviewRequired ? "Record an assessment to decide on certification." : `Exam score: ${p.examScore ?? "n/a"}%.`, dedupeKey: `SCOMP:${p.courseId}:${p.agentProfileId}:${id}` });
    if (p.coachReviewRequired) {
      const existing = await taskRepository.findOpenByRelated(db, "ASSESS_STUDENT", "CourseEnrollment", `${p.agentProfileId}:${p.courseId}`);
      if (!existing) await taskRepository.create(db, { type: "ASSESS_STUDENT", title: `Assess ${p.displayName} — ${p.title}`, assigneeUserId: p.coachUserIds[0], dueAt: new Date(Date.now() + 5 * 24 * 60 * 60_000), relatedType: "CourseEnrollment", relatedId: `${p.agentProfileId}:${p.courseId}` });
    }
  },

  CERTIFICATION_PENDING_REVIEW: async (db, p) => {
    await notifyStaff(db, ["ADMIN"], { type: "CERTIFICATION_PENDING_REVIEW", title: `Certification pending review: ${p.displayName}`, body: `${p.templateName} is waiting for approval under Staff > Academy.`, dedupeKey: `CPR:${p.certificationId}` });
  },

  CERTIFICATION_APPROVED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "CERTIFICATION_APPROVED", title: `You earned ${p.templateName}`, body: `The certification now shows on your profile${p.expiresAt ? ` and is valid until ${new Date(p.expiresAt).toLocaleDateString()}` : ""}.`, email: { to: p.agentEmail }, dedupeKey: `CAPP:${p.certificationId}` });
  },

  CERTIFICATION_REVOKED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "CERTIFICATION_REVOKED", title: `${p.templateName} was revoked`, body: `Reason: ${p.reason}`, email: { to: p.agentEmail }, dedupeKey: `CREV:${p.certificationId}` });
  },

  CERTIFICATION_EXPIRING: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "CERTIFICATION_EXPIRING", title: `${p.templateName} expires soon`, body: `Valid until ${new Date(p.expiresAt).toLocaleDateString()}. Complete the refresher course to renew.`, email: { to: p.agentEmail }, dedupeKey: `CEXP:${p.certificationId}:${p.expiresAt.slice(0, 10)}` });
  },

  ASSESSMENT_FINALISED: async (db, p) => {
    await notifyUser(db, { userId: p.agentUserId, type: "ASSESSMENT_FINALISED", title: "Your coach recorded an assessment", body: `${p.courseTitle ? `${p.courseTitle}: ` : ""}${p.label ?? "Result recorded"}. Open Academy to see the feedback.`, email: { to: p.agentEmail }, dedupeKey: `ASMT:${p.assessmentId}` });
    if (p.courseId) await taskRepository.completeByRelated(db, "ASSESS_STUDENT", "CourseEnrollment", `${p.agentProfileId}:${p.courseId}`);
  },

  // Phase 4 — commercial
  BILLING_RATE_PROPOSED: async (db, p) => {
    await notifyStaff(db, ["ADMIN"], { type: "BILLING_RATE_PROPOSED", title: `Client rate proposed for ${p.displayName}`, body: `${p.currency} ${(p.amount / 100).toFixed(2)} per ${p.unit === "HOURLY" ? "hour" : "month"}. Review under Commercial → Rate approvals.`, dedupeKey: `RATEP:${p.rateId}`, email: true });
    const existing = await taskRepository.findOpenByRelated(db, "APPROVE_RATE", "ClientBillingRate", p.rateId);
    if (!existing) await taskRepository.create(db, { type: "APPROVE_RATE", title: `Approve client rate for ${p.displayName}`, queueRole: "ADMIN", dueAt: new Date(Date.now() + 2 * 24 * 60 * 60_000), relatedType: "ClientBillingRate", relatedId: p.rateId });
  },

  BILLING_RATE_PUBLISHED: async (db, p) => {
    await notifyUser(db, { userId: p.proposedByUserId, type: "BILLING_RATE_PUBLISHED", title: `Client rate published for ${p.displayName}`, body: "Clients now see the rate on the profile. Placements for this agent can be approved.", dedupeKey: `RATEPUB:${p.rateId}` });
    // Agent sees only the boolean (INV-C2): no amount in the notification.
    await notifyUser(db, { userId: p.agentUserId, type: "CLIENT_RATE_PUBLISHED", title: "Your client rate is published", body: "Hirewise has set and published the rate clients pay for your services. You never negotiate rates with clients directly.", dedupeKey: `RATEAG:${p.rateId}` });
    await taskRepository.completeByRelated(db, "APPROVE_RATE", "ClientBillingRate", p.rateId);
  },

  BILLING_RATE_REJECTED: async (db, p) => {
    await notifyUser(db, { userId: p.proposedByUserId, type: "BILLING_RATE_REJECTED", title: `Rate proposal for ${p.displayName} was not approved`, body: p.reason ? `Reason: ${p.reason}` : "Propose again with a revised amount.", dedupeKey: `RATEREJ:${p.rateId}` });
    await taskRepository.completeByRelated(db, "APPROVE_RATE", "ClientBillingRate", p.rateId);
  },

  PLACEMENT_APPROVED: async (db, p) => {
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "PLACEMENT_APPROVED", title: `Hirewise approved ${p.displayName} for ${p.positionTitle}`, body: `Client rate ${p.rateLabel}. Next: review and accept the Placement Service Agreement under Placements, then the deposit of ${p.depositLabel} is due.`, email: p.clientEmail ? { to: p.clientEmail } : undefined, dedupeKey: `PLAPP:${p.placementId}:client` });
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "PLACEMENT_APPROVED", title: `Placement approved: ${p.displayName} for ${p.companyName}`, body: "The client has been asked to accept the service agreement. Follow up if it stalls.", dedupeKey: `PLAPP:${p.placementId}:sales` });
    await taskRepository.completeByRelated(db, "FINALISE_PLACEMENT", "Placement", p.placementId);
  },

  DEPOSIT_REQUIRED: async (db, p) => {
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "DEPOSIT_REQUIRED", title: `Deposit invoice ${p.invoiceNumber} for ${p.displayName}`, body: `${p.currency} ${(p.amount / 100).toFixed(2)} due ${new Date(p.dueAt).toLocaleDateString()}. Open Billing to view the invoice and payment instructions.`, email: p.clientEmail ? { to: p.clientEmail } : undefined, dedupeKey: `DEPREQ:${p.placementId}:${p.invoiceNumber}` });
  },

  DEPOSIT_PAID: async (db, p) => {
    const how = p.how === "WAIVED" ? "waived" : "received";
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "DEPOSIT_PAID", title: `Deposit ${how}: deployment preparation started`, body: `Hirewise is preparing ${p.displayName} for deployment. You will be notified at activation.`, email: p.clientEmail ? { to: p.clientEmail } : undefined, dedupeKey: `DEPPAID:${p.placementId}:client` });
    // Agent: no amounts (Section 9).
    await notifyUser(db, { userId: p.agentUserId, type: "DEPOSIT_PAID", title: `${p.companyName}: deployment preparation started`, body: "The client completed the commercial steps. Operations will confirm your schedule, equipment, and tool access before the start date.", email: { to: p.agentEmail }, dedupeKey: `DEPPAID:${p.placementId}:agent` });
    const staff = await userRepository.idsByRole(db, ["OPERATIONS"]);
    for (const s of [...staff.map((x) => x.id), ...(p.salesUserId ? [p.salesUserId] : [])]) await notifyUser(db, { userId: s, type: "DEPOSIT_PAID", title: `Deposit ${how}: ${p.displayName} for ${p.companyName}`, body: "Run the deployment checklist, set the start date, then activate.", dedupeKey: `DEPPAID:${p.placementId}:${s}` });
    const existing = await taskRepository.findOpenByRelated(db, "DEPLOY_AGENT", "Placement", p.placementId);
    if (!existing) await taskRepository.create(db, { type: "DEPLOY_AGENT", title: `Deploy ${p.displayName} to ${p.companyName}`, queueRole: "OPERATIONS", dueAt: new Date(Date.now() + 5 * 24 * 60 * 60_000), relatedType: "Placement", relatedId: p.placementId });
  },

  CANDIDATE_DEPLOYED: async (db, p) => {
    const start = new Date(p.startDate).toLocaleDateString();
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "CANDIDATE_DEPLOYED", title: `${p.displayName} is active from ${start}`, body: `Your ${p.positionTitle} placement is live. Your account manager stays your point of contact.`, email: p.clientEmail ? { to: p.clientEmail } : undefined, dedupeKey: `DEPLOY:${p.placementId}:client` });
    await notifyUser(db, { userId: p.agentUserId, type: "CANDIDATE_DEPLOYED", title: `You start with ${p.companyName} on ${start}`, body: `Position: ${p.positionTitle}. Follow the client communication rules and keep Hirewise in the loop.`, email: { to: p.agentEmail }, dedupeKey: `DEPLOY:${p.placementId}:agent` });
    const staff = await userRepository.idsByRole(db, ["OPERATIONS"]);
    for (const s of [...staff.map((x) => x.id), ...(p.salesUserId ? [p.salesUserId] : [])]) await notifyUser(db, { userId: s, type: "CANDIDATE_DEPLOYED", title: `Deployed: ${p.displayName} at ${p.companyName}`, body: `Start ${start}.`, dedupeKey: `DEPLOY:${p.placementId}:${s}` });
    await taskRepository.completeByRelated(db, "DEPLOY_AGENT", "Placement", p.placementId);
  },

  PLACEMENT_STATUS_CHANGED: async (db, p) => {
    const label = p.status.toLowerCase();
    const body = `${p.displayName} - ${p.positionTitle} is now ${label}.${p.reason ? ` Reason: ${p.reason}` : ""}`;
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "PLACEMENT_STATUS_CHANGED", title: `Placement ${label}`, body, dedupeKey: `PLST:${p.placementId}:${p.status}:client:${Date.now() >> 16}` });
    await notifyUser(db, { userId: p.agentUserId, type: "PLACEMENT_STATUS_CHANGED", title: `Your placement with ${p.companyName} is ${label}`, body: p.reason ? `Reason: ${p.reason}` : "Contact Hirewise with any questions.", dedupeKey: `PLST:${p.placementId}:${p.status}:agent:${Date.now() >> 16}` });
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "PLACEMENT_STATUS_CHANGED", title: `Placement ${label}: ${p.displayName} at ${p.companyName}`, body, dedupeKey: `PLST:${p.placementId}:${p.status}:sales:${Date.now() >> 16}` });
  },

  // Phase 5
  INCIDENT_CREATED: async (db, p) => {
    await notifyStaff(db, ["ADMIN"], { type: "INCIDENT_CREATED", title: `${p.severity} incident: ${p.type.replace(/_/g, " ").toLowerCase()}`, body: "Review the incident under Compliance → Incidents.", dedupeKey: `INC:${p.incidentId}`, email: p.severity === "HIGH" });
  },

  USER_SUSPENDED: async (db, p) => {
    await notifyUser(db, { userId: p.userId, type: "USER_SUSPENDED", title: "Your account has been suspended", body: `Reason: ${p.reason}. Contact Hirewise to resolve this.`, email: { to: p.email }, dedupeKey: `SUSP:${p.userId}:${Date.now() >> 16}` });
    await notifyStaff(db, ["ADMIN"], { type: "USER_SUSPENDED", title: `User suspended: ${p.email}`, body: p.reason, dedupeKey: `SUSPA:${p.userId}:${Date.now() >> 16}` });
  },

  ONLINE_PAYMENT_RECEIVED: async (db, p) => {
    const amount = `${p.currency} ${(p.amount / 100).toFixed(2)}`;
    if (p.clientUserId) await notifyUser(db, { userId: p.clientUserId, type: "PAYMENT_RECEIVED", title: `Payment received for ${p.number}`, body: `${amount} was received online. Thank you.`, dedupeKey: `OPAY:${p.invoiceId}:client` });
    if (p.salesUserId) await notifyUser(db, { userId: p.salesUserId, type: "PAYMENT_RECEIVED", title: `${p.companyName} paid ${p.number} online`, body: amount, dedupeKey: `OPAY:${p.invoiceId}:sales` });
  },
};
