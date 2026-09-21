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
  MEDIA_REVIEWED: { type: "VIDEO" | "RECORDING"; mediaId: string; agentProfileId: string; userId: string; email: string; outcome: "APPROVED" | "REJECTED" | "REVISION_REQUIRED"; feedback: string | null; title: string };
  CANDIDATE_SHORTLISTED: { clientId: string; companyName: string; agentProfileId: string; displayName: string; accountManagerUserId: string | null };
  PROFILE_REVIEWED: { agentProfileId: string; userId: string; displayName: string; email: string; outcome: "APPROVED" | "REVISION_REQUIRED" | "REJECTED"; feedback: string | null };
};

export type DomainEventType = keyof DomainEventMap;

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  type: T;
  payload: DomainEventMap[T];
};
