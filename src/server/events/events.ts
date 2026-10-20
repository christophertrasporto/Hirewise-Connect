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
  INTERVIEW_SCHEDULED: { interviewId: string; requestId: string; clientUserId: string | null; clientEmail: string | null; agentUserId: string; agentEmail: string; companyName: string; displayName: string; clientLabel: string; scheduledAt: string; timezone: string; meetingLink: string | null; salesUserId: string | null };
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
  // Agency marketplace (A1)
  AGENCY_APPLICATION_SUBMITTED: { applicationId: string; applicantUserId: string; applicantName: string; agencyName: string; resubmission: boolean };
  AGENCY_APPLICATION_DECIDED: { applicationId: string; applicantUserId: string; applicantEmail: string; agencyName: string; status: "NEEDS_MORE_INFO" | "APPROVED" | "REJECTED"; message: string | null; agencyId: string | null };
  // Identity phase 1
  DUPLICATE_FLAG_RAISED: { flagId: string; kind: string; attemptedEmail: string; attemptedName: string; matchReasons: string[]; matchedUserId: string | null; matchedEmail: string | null; notifyExisting: boolean };
  DUPLICATE_FLAG_DECIDED: { flagId: string; decision: "APPROVED_NEW_PROFILE" | "LINKED" | "REJECTED"; attemptedEmail: string; attemptedName: string; continuationUrl: string | null; matchedEmail: string | null };
  TERMS_VERSION_PUBLISHED: { agreementId: string; type: "PLATFORM_TERMS" | "PRIVACY_POLICY"; version: number; title: string; material: boolean; requiresReacceptance: boolean; roles: string[] };
  // v2 phase 2: Agent Seats and invitations
  AGENCY_MEMBER_JOINED: { agencyId: string; agencyName: string; ownerUserId: string; membershipId: string; agentProfileId: string; displayName: string; status: "PENDING_VERIFICATION" | "ACTIVE"; source: string };
  AGENCY_SEATS_CHANGED: { agencyId: string; agencyName: string; ownerUserId: string; ownerEmail: string; changeType: string; quantity: number; reason: string; total: number; available: number };
  SEAT_REQUEST_SUBMITTED: { requestId: string; agencyId: string; agencyName: string; requestedSeats: number; note: string | null };
  SEAT_REQUEST_DECIDED: { requestId: string; agencyId: string; agencyName: string; ownerUserId: string; ownerEmail: string; decision: "APPROVED" | "REJECTED"; grantedSeats: number | null; note: string | null; available: number };
  SEAT_PURCHASE_CREATED: { purchaseId: string; agencyId: string; agencyName: string; seatCount: number; amountMinor: number; currency: string };
  SEAT_PURCHASE_RECORDED: { purchaseId: string; agencyId: string; agencyName: string; ownerUserId: string; ownerEmail: string; outcome: "PAID" | "WAIVED" | "CANCELLED"; seatCount: number; available: number };
  // v2 phase 3: exits
  EXIT_REQUESTED: { exitRequestId: string; type: "AGENT_REQUESTED_LEAVE" | "AGENCY_REQUESTED_REMOVAL"; agencyId: string; agencyName: string; ownerUserId: string; agentUserId: string; agentEmail: string; displayName: string; reason: string; effectiveOption: string };
  EXIT_DECIDED: { exitRequestId: string; type: "AGENT_REQUESTED_LEAVE" | "AGENCY_REQUESTED_REMOVAL"; decision: "APPROVED" | "DECLINED" | "CANCELLED"; by: "AGENCY" | "ADMIN" | "AGENT"; agencyId: string; agencyName: string; ownerUserId: string; agentUserId: string; agentEmail: string; displayName: string; note: string | null; effectiveAt: string | null };
  EXIT_ESCALATED: { exitRequestId: string; type: "AGENT_REQUESTED_LEAVE" | "AGENCY_REQUESTED_REMOVAL"; agencyId: string; agencyName: string; displayName: string; why: string };
  AGENCY_EXIT_COMPLETED: { membershipId: string; exitRequestId: string | null; agencyId: string; agencyName: string; ownerUserId: string; agentProfileId: string; agentUserId: string; displayName: string; reason: string };
  // v2 phase 4: credential sources, Course Seats, independent access
  COURSE_PURCHASE_CREATED: { purchaseId: string; agencyId: string; agencyName: string; courseTitle: string; seatCount: number; amountMinor: number; currency: string };
  COURSE_PURCHASE_RECORDED: { purchaseId: string; agencyId: string; agencyName: string; ownerUserId: string; ownerEmail: string; courseTitle: string; seatCount: number; outcome: "PAID" | "WAIVED" | "CANCELLED" };
  COURSE_SEAT_ASSIGNED: { assignmentId: string; agencyId: string; agencyName: string; courseTitle: string; agentUserId: string; agentEmail: string; displayName: string };
  CREDENTIALS_REVOKED: { agencyId: string; agencyName: string; agentProfileId: string; agentUserId: string; ownerUserId: string; displayName: string; courses: string[]; certifications: string[]; assessments: number; seatsReturned: number };
  INDEPENDENT_APPLIED: { accessId: string; userId: string; email: string; feeMinor: number; currency: string; pendingPayment: boolean };
  INDEPENDENT_ACTIVATED: { accessId: string; userId: string; email: string; profileId: string };
  // v2 phase 5: client protection
  CLIENT_SAFE_DOCUMENT_NEEDS_REVIEW: { documentId: string; agentProfileId: string; displayName: string; type: string };
  CLIENT_SAFE_DOCUMENT_REVIEWED: { documentId: string; agentProfileId: string; agentUserId: string; agentEmail: string; type: string; title: string; outcome: "APPROVED_FOR_CLIENT" | "REJECTED"; note: string | null };
  // v2 phase 6a: communication and enforcement
  THREAD_MESSAGE_POSTED: { threadId: string; messageId: string; kind: string; title: string; authorRole: string; visibleTo: string; recipientUserIds: string[]; preview: string; masked: boolean };
  BYPASS_REPORTED: { reportId: string; reporterRole: string; reporterUserId: string; description: string; reportedLabel: string };
  BYPASS_DECIDED: { reportId: string; status: string; reporterUserId: string; reportedUserId: string | null; reportedOwnerUserId: string | null; note: string | null };
  DISCLOSURE_CHANGED: { grantId: string; scope: "AGENT_IDENTITY" | "AGENCY_IDENTITY" | "CLIENT_IDENTITY"; action: "GRANTED" | "REVOKED"; clientId: string; companyName: string; subjectLabel: string; accountManagerUserId: string | null; grantedBy: "STAFF" | "SYSTEM" };
  AGENCY_STATUS_CHANGED: { agencyId: string; agencyName: string; status: "ACTIVE" | "SUSPENDED" | "INACTIVE"; reason: string; ownerUserId: string; ownerEmail: string };
  // Course Builder phase 7
  ASSIGNMENT_SUBMITTED: { submissionId: string; lessonId: string; lessonTitle: string; courseId: string; courseTitle: string; agentProfileId: string; displayName: string; coachUserIds: string[]; late: boolean; resubmission: boolean };
  ASSIGNMENT_REVIEWED: { submissionId: string; lessonId: string; lessonTitle: string; courseId: string; courseTitle: string; agentUserId: string; agentEmail: string; decision: "GRADED" | "RETURNED"; grade: number | null; maxPoints: number | null; feedback: string | null };
  ATTEMPT_PENDING_REVIEW: { attemptId: string; lessonId: string; lessonTitle: string; courseId: string; courseTitle: string; agentProfileId: string; displayName: string; coachUserIds: string[] };
  ASSESSMENT_FINALISED: { assessmentId: string; agentProfileId: string; courseId: string | null; agentUserId: string; agentEmail: string; label: string | null; courseTitle: string | null };
  // Phase 4 — commercial. Agent-facing payloads never carry client financial terms (Section 9).
  BILLING_RATE_PROPOSED: { rateId: string; agentProfileId: string; displayName: string; proposedByUserId: string; amount: number; currency: string; unit: string };
  BILLING_RATE_PUBLISHED: { rateId: string; agentProfileId: string; agentUserId: string; displayName: string; proposedByUserId: string };
  BILLING_RATE_REJECTED: { rateId: string; displayName: string; proposedByUserId: string; reason: string };
  PLACEMENT_APPROVED: { placementId: string; clientUserId: string | null; clientEmail: string | null; companyName: string; displayName: string; clientLabel: string; positionTitle: string; salesUserId: string | null; rateLabel: string; depositLabel: string };
  DEPOSIT_REQUIRED: { placementId: string; clientUserId: string | null; clientEmail: string | null; companyName: string; invoiceNumber: string; amount: number; currency: string; dueAt: string; displayName: string };
  DEPOSIT_PAID: { placementId: string; how: "PAID" | "WAIVED"; clientUserId: string | null; clientEmail: string | null; companyName: string; agentUserId: string; agentEmail: string; displayName: string; salesUserId: string | null };
  CANDIDATE_DEPLOYED: { placementId: string; clientUserId: string | null; clientEmail: string | null; companyName: string; agentUserId: string; agentEmail: string; displayName: string; clientLabel: string; positionTitle: string; startDate: string; salesUserId: string | null };
  PLACEMENT_STATUS_CHANGED: { placementId: string; status: string; reason: string | null; clientUserId: string | null; companyName: string; agentUserId: string; displayName: string; clientLabel: string; positionTitle: string; salesUserId: string | null };
  // Phase 5
  INCIDENT_CREATED: { incidentId: string; subjectUserId: string; type: string; severity: string; reportedByUserId: string };
  USER_SUSPENDED: { userId: string; email: string; reason: string };
  ONLINE_PAYMENT_RECEIVED: { invoiceId: string; number: string; amount: number; currency: string; clientUserId: string | null; companyName: string; salesUserId: string | null };
};

export type DomainEventType = keyof DomainEventMap;

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  type: T;
  payload: DomainEventMap[T];
};
