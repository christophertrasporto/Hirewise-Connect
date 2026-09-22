/**
 * Domain events written to the outbox inside the same transaction as the state
 * change (Section 3.3). The worker turns them into notifications, tasks, and emails.
 */
export type DomainEventMap = {
  USER_CREATED: { userId: string; role: string; email: string };
  SETTING_CHANGED: { key: string; changedBy: string | null };
  CLIENT_REGISTERED: { clientId: string; userId: string; companyName: string; email: string };
  CLIENT_ACTIVATED: { clientId: string; userId: string; companyName: string; email: string };
  AGENT_REGISTERED: { agentProfileId: string; userId: string; displayName: string; email: string };
  PROFILE_SUBMITTED: { agentProfileId: string; userId: string; displayName: string };
  PROFILE_REVIEWED: { agentProfileId: string; userId: string; displayName: string; email: string; outcome: "APPROVED" | "REVISION_REQUIRED" | "REJECTED"; feedback: string | null };
  MEDIA_REVIEWED: { type: "VIDEO" | "RECORDING"; mediaId: string; agentProfileId: string; userId: string; email: string; outcome: "APPROVED" | "REJECTED" | "REVISION_REQUIRED"; feedback: string | null; title: string };
  CANDIDATE_SHORTLISTED: { clientId: string; companyName: string; agentProfileId: string; displayName: string; accountManagerUserId: string | null };
  // Phase 2
  INTERVIEW_REQUESTED: { requestId: string; clientId: string; companyName: string; accountManagerUserId: string | null; candidateCount: number; role: string };
  INTERVIEW_SLOTS_PROPOSED: { requestId: string; userId: string; email: string; role: string; audience: "CLIENT" };
  CLIENT_CONFIRMED_SLOTS: { requestId: string; salesUserId: string; companyName: string };
  CANDIDATE_CONFIRMATION_REQUESTED: { requestId: string; agentProfileId: string; userId: string; email: string; role: string; schedule: string | null; timezone: string };
  CANDIDATE_RESPONDED: { requestId: string; salesUserId: string; displayName: string; response: "CONFIRMED" | "DECLINED" };
  INTERVIEW_SCHEDULED: { interviewId: string; requestId: string; clientUserId: string | null; clientEmail: string | null; agentUserId: string; agentEmail: string; companyName: string; displayName: string; scheduledAt: string; timezone: string; meetingLink: string | null; salesUserId: string | null };
  CLIENT_DECISION_REQUESTED: { requestId: string; userId: string; email: string; role: string };
  CANDIDATE_SELECTED: { placementId: string; requestId: string; clientId: string; companyName: string; agentProfileId: string; agentUserId: string; agentEmail: string; displayName: string; salesUserId: string | null };
  CANDIDATE_NOT_SELECTED: { requestId: string; agentUserId: string; agentEmail: string; role: string };
  SECOND_INTERVIEW_REQUESTED: { requestId: string; salesUserId: string; companyName: string; displayName: string };
  INTERVIEW_REQUEST_CANCELLED: { requestId: string; companyName: string; role: string; salesUserId: string | null; clientUserId: string | null; agentUserIds: string[]; byRole: string };
  MESSAGE_POSTED: { requestId: string; messageId: string; authorRole: string; visibleTo: string; clientUserId: string | null; agentUserIds: string[]; salesUserId: string | null; preview: string };
  MESSAGE_HELD_FOR_REVIEW: { requestId: string; messageId: string; salesUserId: string | null; authorRole: string; reasons: string[] };
  RESERVATION_EXPIRING: { reservationId: string; reservedById: string; displayName: string; companyName: string; expiresAt: string };
  RESERVATION_EXPIRED: { reservationId: string; reservedById: string; displayName: string; companyName: string };
  // Phase 3
  COURSE_SUBMITTED_FOR_APPROVAL: { courseId: string; title: string; coachUserId: string; priceCents: number };
  COURSE_PUBLISHED: { courseId: string; title: string; coachUserId: string };
  COURSE_ENROLLED: { courseId: string; title: string; agentProfileId: string; agentUserId: string; coachUserIds: string[]; paymentRequired: boolean; priceCents: number };
  COURSE_PAYMENT_RECORDED: { enrollmentId: string; courseTitle: string; agentUserId: string; agentEmail: string; waived: boolean };
  COURSE_COMPLETED: { courseId: string; title: string; agentProfileId: string; agentUserId: string; agentEmail: string; displayName: string; examScore: number | null; coachUserIds: string[]; coachReviewRequired: boolean };
  CERTIFICATION_PENDING_REVIEW: { certificationId: string; templateName: string; agentProfileId: string; displayName: string };
  CERTIFICATION_APPROVED: { certificationId: string; templateName: string; agentProfileId: string; agentUserId: string; agentEmail: string; expiresAt: string | null };
  CERTIFICATION_REVOKED: { certificationId: string; templateName: string; agentUserId: string; agentEmail: string; reason: string };
  CERTIFICATION_EXPIRING: { certificationId: string; templateName: string; agentUserId: string; agentEmail: string; expiresAt: string };
  ASSESSMENT_FINALISED: { assessmentId: string; agentProfileId: string; courseId: string | null; agentUserId: string; agentEmail: string; label: string | null; courseTitle: string | null };
};

export type DomainEventType = keyof DomainEventMap;

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  type: T;
  payload: DomainEventMap[T];
};
